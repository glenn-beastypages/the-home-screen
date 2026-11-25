import type { Express, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
  listing,
  blocked,
  fail,
  id,
  transaction,
  uuid,
  wrap,
  type DB,
} from "./common.js";
import { practiceShelf, type Stage } from "../src/practice-types.js";

const kinds = z.enum(["purchase", "trade", "message"]);
const method = z.enum(["pickup", "shipping"]);
const bodyText = z.string().trim().min(1).max(1000);
const start = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      listingId: id,
      requestId: id,
      body: bodyText,
    })
    .strict(),
  z
    .object({
      kind: z.literal("purchase"),
      listingId: id,
      requestId: id,
      method,
    })
    .strict(),
  z
    .object({
      kind: z.literal("trade"),
      listingId: id,
      requestId: id,
      method,
      offered: z.union([id, z.enum(["tote", "speaker"])]),
    })
    .strict(),
]);
const action = z
  .object({
    version: z.number().int().positive(),
    action: z.enum([
      "message",
      "seller",
      "accept",
      "cancel",
      "dispatch",
      "arrive",
      "collect",
      "complete",
    ]),
    body: bodyText.optional(),
  })
  .strict();
const summary = `SELECT s.id,s.listing_id AS "listingId",l.title,l.code,p.name AS seller,s.kind,s.state,s.method,s.price_cents AS "priceCents",s.offer,s.version
 FROM catalog_practice s JOIN listings l ON l.id=s.listing_id JOIN profiles p ON p.id=l.owner_id`;

async function target(
  db: DB,
  listingId: string,
  actor: string,
  existingActivity = false,
) {
  const row = (
    await db.query(
      `SELECT l.id,l.title,l.owner_id,l.price_cents,l.condition,l.code FROM listings l JOIN profiles p ON p.id=l.owner_id
    WHERE l.id=$1 AND l.is_demo AND p.is_demo AND l.status='active' AND p.status='active' AND NOT l.is_hidden AND NOT l.demo_disabled AND ($2 OR NOT l.catalog_retired) AND l.published_at IS NOT NULL FOR SHARE OF l,p`,
      [listingId, existingActivity],
    )
  ).rows[0];
  if (!row || (await blocked(db, actor, row.owner_id)))
    fail(404, "This listing is unavailable.", "NOT_FOUND");
  return row;
}
async function recordMessage(
  db: DB,
  session: string,
  version: number,
  text: string,
  item: { title: string; condition: string; code: string },
) {
  let reply = `You can buy ${item.title} or make a trade offer from slot ${item.code}. Which would you like to try?`;
  if (/condition|wear|used|new/i.test(text))
    reply = `The condition listed for ${item.title} is “${item.condition}”. You can see the photo and details on the listing.`;
  else if (/ship|deliver|pick\s?up|meet/i.test(text))
    reply =
      "You can choose shipping or local pickup at checkout. I can walk through either in this simulation.";
  else if (/available|still|hello|hey|hi\b/i.test(text))
    reply = `Yes, ${item.title} is available for purchase or trade.`;
  await db.query(
    "INSERT INTO catalog_practice_messages(practice_id,version,body,reply) VALUES($1,$2,$3,$4)",
    [session, version, text, reply],
  );
}
export function registerCatalogPractice(
  app: Express,
  pool: Pool,
  requireUser: (res: Response) => string,
) {
  app.get(
    "/api/practice",
    wrap(async (req, res) => {
      const actor = requireUser(res),
        kind = kinds.parse(req.query.kind),
        listingId = id.optional().parse(req.query.listingId);
      const rows = await pool.query(
        summary +
          ` WHERE s.actor_id=$1 AND s.kind=$2 AND ($3::uuid IS NULL OR s.listing_id=$3)
      AND l.is_demo AND p.is_demo AND l.status='active' AND l.published_at IS NOT NULL AND NOT l.is_hidden AND NOT l.demo_disabled AND p.status='active'
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=$1 AND b.target_id=p.id) OR (b.user_id=p.id AND b.target_id=$1))
      ORDER BY s.updated_at DESC,s.id DESC`,
        [actor, kind, listingId ?? null],
      );
      res.json({ items: rows.rows });
    }),
  );
  app.post(
    "/api/practice",
    wrap(async (req, res) => {
      const actor = requireUser(res),
        b = start.parse(req.body);
      const session = await transaction(pool, async (db) => {
        // Serialize starts per shopper so a retried checkout or two tabs share the open session.
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "catalog-practice:" + actor,
        ]);
        const item = await target(db, b.listingId, actor);
        const previous = (
          await db.query(
            `SELECT id,listing_id,kind,start_key FROM catalog_practice WHERE actor_id=$1 AND (start_key=$2 OR
        (listing_id=$3 AND kind=$4 AND state NOT IN ('complete','canceled'))) ORDER BY (start_key=$2) DESC LIMIT 1`,
            [actor, b.requestId, b.listingId, b.kind],
          )
        ).rows[0];
        if (previous) {
          if (previous.listing_id !== b.listingId || previous.kind !== b.kind)
            fail(409, "This request has already been used.");
          if (previous.start_key !== b.requestId)
            fail(
              409,
              "There is already an open " +
                (b.kind === "message"
                  ? "conversation"
                  : b.kind === "trade"
                    ? "trade"
                    : "order") +
                " for this listing. Reopen it from your activity.",
              "ALREADY_OPEN",
            );
          return previous.id;
        }
        let offer = null;
        if (b.kind === "trade") {
          offer = Object.hasOwn(practiceShelf, b.offered)
            ? practiceShelf[b.offered]
            : (
                await db.query(
                  `SELECT code,title,price_cents AS "priceCents" FROM listings WHERE id=$1 AND owner_id=$2 AND status='active' AND NOT is_hidden AND trade_enabled FOR SHARE`,
                  [b.offered, actor],
                )
              ).rows[0];
          if (!offer) fail(400, "Choose an available item from your shelf.");
        }
        if (b.kind === "purchase" && item.price_cents === null)
          fail(409, "This item has no purchase price.");
        const newId = uuid();
        await db.query(
          `INSERT INTO catalog_practice(id,actor_id,listing_id,kind,state,method,price_cents,offer,start_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            newId,
            actor,
            item.id,
            b.kind,
            b.kind === "message"
              ? "conversation"
              : b.kind === "trade"
                ? "offered"
                : "confirmed",
            b.kind === "message" ? null : b.method,
            item.price_cents,
            offer,
            b.requestId,
          ],
        );
        if (b.kind === "message")
          await recordMessage(db, newId, 1, b.body, item);
        return newId;
      });
      res.json({ id: session });
    }),
  );
  app.get(
    "/api/practice/:id",
    wrap(async (req, res) => {
      const actor = requireUser(res),
        key = id.parse(req.params.id);
      const detail = await transaction(pool, async (db) => {
        const session = (
          await db.query(
            summary + " WHERE s.id=$1 AND s.actor_id=$2 FOR SHARE OF s",
            [key, actor],
          )
        ).rows[0];
        if (!session) fail(404, "Activity not found.", "NOT_FOUND");
        await target(db, session.listingId, actor, true);
        const messages = (
          await db.query(
            "SELECT version,body,reply FROM catalog_practice_messages WHERE practice_id=$1 ORDER BY version",
            [key],
          )
        ).rows;
        return {
          session,
          messages,
          listing: await listing(db, session.listingId, actor),
        };
      });
      res.json(detail);
    }),
  );
  app.post(
    "/api/practice/:id",
    wrap(async (req, res) => {
      const actor = requireUser(res),
        key = id.parse(req.params.id),
        b = action.parse(req.body);
      await transaction(pool, async (db) => {
        const s = (
          await db.query(
            "SELECT * FROM catalog_practice WHERE id=$1 AND actor_id=$2 FOR UPDATE",
            [key, actor],
          )
        ).rows[0];
        if (!s) fail(404, "Activity not found.", "NOT_FOUND");
        const item = await target(db, s.listing_id, actor, true);
        if (s.version !== b.version)
          fail(
            409,
            "This activity changed. Review its latest status.",
            "STALE_ACTIVITY",
          );
        let next: Stage;
        if (b.action === "message" && s.kind === "message" && b.body) {
          await recordMessage(db, key, s.version + 1, b.body, item);
          next = "conversation";
        } else if (b.action === "seller" && s.state === "offered") {
          next =
            s.method === "shipping" &&
            s.offer?.priceCents != null &&
            s.offer.priceCents < s.price_cents
              ? "countered"
              : "confirmed";
        } else if (b.action === "accept" && s.state === "countered")
          next = "confirmed";
        else if (
          b.action === "cancel" &&
          ["offered", "countered", "confirmed"].includes(s.state)
        )
          next = "canceled";
        else if (b.action === "dispatch" && s.state === "confirmed")
          next = s.method === "shipping" ? "transit" : "ready";
        else if (b.action === "arrive" && s.state === "transit")
          next = "received";
        else if (
          (b.action === "collect" && s.state === "ready") ||
          (b.action === "complete" && s.state === "received")
        )
          next = "complete";
        else
          fail(
            409,
            "This action is unavailable at this stage.",
            "INVALID_STAGE",
          );
        await db.query(
          "UPDATE catalog_practice SET state=$2,method=CASE WHEN $3 THEN 'pickup' ELSE method END,version=version+1,updated_at=now() WHERE id=$1",
          [key, next, b.action === "accept"],
        );
      });
      res.json({ ok: true });
    }),
  );
}
