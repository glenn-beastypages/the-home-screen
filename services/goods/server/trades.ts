import type { Express, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
  activePeople,
  blocked,
  clientKey,
  type DB,
  type Row,
  event,
  fail,
  getProfile,
  hash,
  id,
  invalidateOffers,
  listing,
  lockListings,
  notify,
  page,
  pagination,
  transaction,
  uuid,
  wrap,
} from "./common.js";
import {
  maxShippedValue,
  queueShippingResolution,
  setupShipping,
  validateShippingAction,
} from "./shipped-trades.js";
import { shippingAddress } from "./shipped-providers.js";
import { finalizeTrade } from "./trade-lifecycle.js";

const fulfillment = z.enum(["meetup", "arranged_shipping", "shipping"]);
const itemList = z.array(id).min(1).max(10);
const offerFields = {
  clientRequestId: clientKey,
  message: z.string().trim().max(2000).optional(),
  fulfillment: fulfillment.default("meetup"),
  balanceValues: z.boolean().default(false),
  cashAdjustmentCents: z.number().int().min(50).max(maxShippedValue).optional(),
};
const createOffer = z.union([
  z
    .object({
      ...offerFields,
      offeredListingIds: itemList,
      requestedListingIds: itemList,
    })
    .strict(),
  z
    .object({ ...offerFields, offeredListingId: id, requestedListingId: id })
    .strict(),
]);
const counterOffer = z
  .object({
    ...offerFields,
    offeredListingIds: itemList,
    requestedListingIds: itemList,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const planCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose"),
      expectedVersion: z.number().int().min(0),
      place: z.string().trim().min(3).max(160).optional(),
      time: z.string().trim().min(3).max(120).optional(),
      shipBy: z.iso.date().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
]);
const shipmentCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("address"), address: shippingAddress }).strict(),
  z
    .object({
      action: z.literal("tracking"),
      carrier: z.string().trim().min(2).max(32),
      code: z
        .string()
        .trim()
        .regex(/^[a-z\d-]{6,40}$/i),
    })
    .strict(),
]);
type Shipment = {
  address?: z.infer<typeof shippingAddress>;
  tracking?: { carrier: string; code: string };
};

function otherParticipant(trade: Row, viewer: string): string {
  return trade.sender_id === viewer ? trade.recipient_id : trade.sender_id;
}

function shippingSummary(trade: Row, viewer?: string) {
  if (trade.fulfillment !== "arranged_shipping" || !viewer) return null;
  const own: Shipment = trade.shipments[viewer] ?? {};
  const other: Shipment =
    trade.shipments[otherParticipant(trade, viewer)] ?? {};
  return {
    yours: own,
    theirs: {
      address:
        trade.state === "accepted" &&
        trade.exchange_plan?.confirmedBy.length === 2
          ? other.address
          : undefined,
      tracking: other.tracking,
    },
  };
}

async function findTrade(
  db: DB,
  tradeId: string,
  viewer: string,
  lock = false,
): Promise<Row> {
  const trade = (
    await db.query(
      "SELECT * FROM trade_offers WHERE id=$1" +
        (lock ? " FOR NO KEY UPDATE" : ""),
      [tradeId],
    )
  ).rows[0];
  if (!trade || ![trade.sender_id, trade.recipient_id].includes(viewer))
    fail(404, "Trade not found.", "NOT_FOUND");
  return trade;
}

function checkRevision(trade: Row, expected: number | undefined) {
  if (expected !== trade.revision)
    fail(409, "This offer changed. Review the latest version.", "STALE_OFFER");
}

function uniqueItems(offered: string[], requested: string[]) {
  const items = [...offered, ...requested];
  if (new Set(items).size !== items.length)
    fail(400, "Choose each item only once.", "DUPLICATE_ITEM");
  return items;
}

function available(row: Row | undefined, owner: string) {
  return (
    row &&
    row.owner_id === owner &&
    row.status === "active" &&
    !row.is_hidden &&
    !row.demo_disabled &&
    row.trade_enabled
  );
}

async function snapshotItems(
  db: DB,
  rows: Row[],
  ids: string[],
  owner: string,
  viewer: string,
) {
  const items = ids.map((itemId) => rows.find((row) => row.id === itemId));
  for (const row of items) {
    if (!row) fail(404, "An item is unavailable.", "NOT_FOUND");
    if (row.owner_id !== owner)
      fail(
        403,
        "Each side must contain only that person's items.",
        "FORBIDDEN",
      );
    if (!available(row, owner))
      fail(
        409,
        "An item is no longer available for trade.",
        "ITEM_UNAVAILABLE",
      );
  }
  return Promise.all(ids.map((itemId) => listing(db, itemId, viewer)));
}

function shippingDifference(
  offered: { priceCents: number | null }[],
  requested: { priceCents: number | null }[],
  method: z.infer<typeof fulfillment>,
  balance: boolean,
  shippingEnabled: boolean,
  adjustment?: number,
) {
  if (method !== "shipping") {
    if (balance || adjustment !== undefined)
      fail(
        400,
        "Cash adjustments require shipping with card holds.",
        "SHIPPING_REQUIRED",
      );
    return 0;
  }
  if (!shippingEnabled)
    fail(
      409,
      "Shipping with card holds is unavailable.",
      "SHIPPING_UNAVAILABLE",
    );
  const values = [...offered, ...requested].map((item) => item.priceCents);
  const total = (items: typeof offered) =>
    items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
  const a = total(offered),
    b = total(requested);
  if (
    values.some((value) => value === null || value < 50) ||
    a > maxShippedValue ||
    b > maxShippedValue
  )
    fail(
      400,
      "For card holds, price every item at $0.50 or more and keep each side under $5,000.",
      "TRADE_VALUE_REQUIRED",
    );
  const difference = Math.abs(a - b);
  if (adjustment !== undefined && (balance || adjustment > difference))
    fail(
      400,
      "Choose one cash amount that is no higher than the difference between the listing totals.",
      "INVALID_CASH_ADJUSTMENT",
    );
  const cash = adjustment ?? (balance ? difference : 0);
  if (cash > 0 && cash < 50)
    fail(
      400,
      "Cash differences must be at least $0.50.",
      "CASH_DIFFERENCE_TOO_SMALL",
    );
  return cash;
}

async function recordProposal(
  db: DB,
  tradeId: string,
  actor: string,
  action: "proposed" | "countered",
  proposal: {
    offered: Awaited<ReturnType<typeof snapshotItems>>;
    requested: Awaited<ReturnType<typeof snapshotItems>>;
    fulfillment: z.infer<typeof fulfillment>;
    cashDifferenceCents: number;
    revision: number;
  },
) {
  await db.query(
    "INSERT INTO trade_events(id,trade_id,actor_id,action,proposal) VALUES($1,$2,$3,$4,$5)",
    [uuid(), tradeId, actor, action, JSON.stringify(proposal)],
  );
}

async function addOfferMessage(
  db: DB,
  conversationId: string,
  senderId: string,
  text: string | undefined,
  key: string,
) {
  if (!text) return;
  await db.query(
    "INSERT INTO messages(id,conversation_id,sender_id,body,client_request_id,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())",
    [uuid(), conversationId, senderId, text, key],
  );
  await db.query(
    "UPDATE conversations SET updated_at=clock_timestamp() WHERE id=$1",
    [conversationId],
  );
}

async function saveCommand(
  db: DB,
  actor: string,
  key: string,
  tradeId: string,
  digest: string,
) {
  await db.query(
    "INSERT INTO trade_commands(actor_id,client_request_id,trade_id,request_hash) VALUES($1,$2,$3,$4)",
    [actor, key, tradeId, digest],
  );
}

async function alreadyRan(db: DB, actor: string, key: string, digest: string) {
  const command = (
    await db.query(
      "SELECT request_hash FROM trade_commands WHERE actor_id=$1 AND client_request_id=$2",
      [actor, key],
    )
  ).rows[0];
  if (!command) return false;
  if (command.request_hash !== digest)
    fail(
      409,
      "This request ID was already used for a different action.",
      "IDEMPOTENCY_CONFLICT",
    );
  return true;
}

export async function serializeTrade(
  db: DB,
  tradeId: string,
  viewerId?: string,
) {
  const r = (
    await db.query(
      `SELECT t.*, c.id AS conversation_id,
     CASE WHEN $2::text IS NOT NULL THEN (
       SELECT jsonb_agg(jsonb_build_object(
         'id', e.id, 'actorId', e.actor_id, 'action', e.action,
         'reason', e.reason, 'createdAt', e.created_at, 'proposal', e.proposal
       ) ORDER BY e.event_order)
       FROM trade_events e WHERE e.trade_id=t.id
     ) END AS events
     FROM trade_offers t LEFT JOIN conversations c ON c.trade_id=t.id
     WHERE t.id=$1`,
      [tradeId, viewerId ?? null],
    )
  ).rows[0];
  if (!r) fail(404, "Trade not found.", "NOT_FOUND");
  const events = (r.events ?? []).map((event: Row) => ({
    ...event,
    createdAt: new Date(event.createdAt).toISOString(),
  }));
  return {
    id: r.id,
    sender: await getProfile(db, r.sender_id),
    recipient: await getProfile(db, r.recipient_id),
    offered: r.offered_snapshot,
    requested: r.requested_snapshot,
    offeredItems: r.offered_bundle,
    requestedItems: r.requested_bundle,
    proposedBy: r.proposed_by,
    revision: r.revision,
    updatedAt: r.updated_at.toISOString(),
    planRequired: r.plan_required,
    exchangePlan: r.exchange_plan,
    shipments: shippingSummary(r, viewerId),
    state: r.state,
    fulfillment: r.fulfillment,
    cashDifferenceCents: r.cash_difference_cents,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    confirmedBy: r.confirmed_by,
    cancelRequestedBy: r.cancel_requested_by,
    conversationId: r.conversation_id,
    events,
  };
}

export async function createConversation(
  db: DB,
  a: string,
  b: string,
  listingId: string | null,
  tradeId: string | null,
) {
  await activePeople(db, [a, b]);
  const pairs = (
    await db.query(
      "SELECT LEAST($1::text,$2::text) AS a,GREATEST($1::text,$2::text) AS b",
      [a, b],
    )
  ).rows[0];
  const existing = (
    await db.query(
      `SELECT * FROM conversations WHERE participant_a=$1 AND participant_b=$2 AND ${tradeId ? "trade_id" : "listing_id"}=$3`,
      [pairs.a, pairs.b, tradeId ?? listingId],
    )
  ).rows[0];
  if (existing) return existing;
  return (
    await db.query(
      "INSERT INTO conversations(id,participant_a,participant_b,listing_id,trade_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [uuid(), pairs.a, pairs.b, listingId, tradeId],
    )
  ).rows[0];
}

export async function expireOffers(pool: Pool, userId: string) {
  const due = (
    await pool.query(
      `SELECT id FROM trade_offers WHERE state='pending' AND expires_at<=now() AND $1 IN (sender_id,recipient_id) ORDER BY expires_at,id LIMIT 200`,
      [userId],
    )
  ).rows;
  for (const candidate of due) {
    await transaction(pool, async (db) => {
      const r = (
        await db.query(
          `UPDATE trade_offers SET state='expired',updated_at=now() WHERE id=$1 AND state='pending' AND expires_at<=now() RETURNING id,sender_id,recipient_id`,
          [candidate.id],
        )
      ).rows[0];
      if (!r) return;
      await event(
        db,
        r.id,
        null,
        "expired",
        "No response before the seven-day expiry.",
      );
      for (const person of [r.sender_id, r.recipient_id])
        await notify(
          db,
          person,
          "Trade offer expired",
          "This offer expired before acceptance.",
          `/trades/${r.id}`,
        );
    });
  }
}

export async function finishTrade(
  db: DB,
  t: Record<string, any>,
  state: "completed" | "canceled",
) {
  await finalizeTrade(db, { id: t.id, item_ids: t.item_ids }, state);
}

export function registerTrades(
  app: Express,
  pool: Pool,
  requireUser: (res: Response) => string,
  shippingEnabled: boolean,
) {
  app.post(
    "/api/trades",
    wrap(async (req, res) => {
      const userId = requireUser(res);
      const body = createOffer.parse(req.body);
      const modern = "offeredListingIds" in body;
      const offeredIds = modern
        ? body.offeredListingIds
        : [body.offeredListingId];
      const requestedIds = modern
        ? body.requestedListingIds
        : [body.requestedListingId];
      const itemIds = uniqueItems(offeredIds, requestedIds);
      const requestHash = modern
        ? hash([
            offeredIds,
            requestedIds,
            body.message ?? "",
            body.fulfillment,
            body.balanceValues,
            ...(body.cashAdjustmentCents !== undefined
              ? [body.cashAdjustmentCents]
              : []),
          ])
        : hash([
            offeredIds[0],
            requestedIds[0],
            body.message ?? "",
            ...(body.fulfillment !== "meetup" || body.balanceValues
              ? [body.fulfillment, body.balanceValues]
              : []),
            ...(body.cashAdjustmentCents !== undefined
              ? [body.cashAdjustmentCents]
              : []),
          ]);
      const tradeId = await transaction(pool, async (db) => {
        const target = (
          await db.query("SELECT owner_id FROM listings WHERE id=$1", [
            requestedIds[0],
          ])
        ).rows[0];
        if (!target)
          fail(404, "The requested item is unavailable.", "NOT_FOUND");
        if (target.owner_id === userId)
          fail(400, "You cannot trade with yourself.", "SELF_TRADE");
        await activePeople(db, [userId, target.owner_id], true);
        const existing = (
          await db.query(
            "SELECT id,request_hash FROM trade_offers WHERE sender_id=$1 AND client_request_id=$2",
            [userId, body.clientRequestId],
          )
        ).rows[0];
        if (existing) {
          if (existing.request_hash !== requestHash)
            fail(
              409,
              "This request ID was already used for a different offer.",
              "IDEMPOTENCY_CONFLICT",
            );
          return existing.id;
        }
        if (await blocked(db, userId, target.owner_id))
          fail(403, "These accounts cannot interact.", "BLOCKED");

        const rows = await lockListings(db, itemIds);
        const offered = await snapshotItems(
          db,
          rows,
          offeredIds,
          userId,
          userId,
        );
        const requested = await snapshotItems(
          db,
          rows,
          requestedIds,
          target.owner_id,
          userId,
        );
        const cash = shippingDifference(
          offered,
          requested,
          body.fulfillment,
          body.balanceValues,
          shippingEnabled,
          body.cashAdjustmentCents,
        );
        if (modern) {
          const duplicate = (
            await db.query(
              `SELECT id FROM trade_offers
               WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))
                 AND state='pending' AND expires_at>now() AND item_ids @> $3::uuid[] AND item_ids <@ $3::uuid[]`,
              [userId, target.owner_id, itemIds],
            )
          ).rows[0];
          if (duplicate)
            fail(
              409,
              "An offer for these items is already open. Continue it in Trades.",
              "DUPLICATE_OFFER",
            );
        }

        const tradeId = uuid();
        await db.query(
          `INSERT INTO trade_offers
           (id,sender_id,recipient_id,offered_id,requested_id,offered_version,requested_version,
            offered_snapshot,requested_snapshot,client_request_id,request_hash,fulfillment,cash_difference_cents,
            offered_bundle,requested_bundle,item_ids,proposed_by,plan_required)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$2,$17)`,
          [
            tradeId,
            userId,
            target.owner_id,
            offered[0].id,
            requested[0].id,
            offered[0].version,
            requested[0].version,
            JSON.stringify(offered[0]),
            JSON.stringify(requested[0]),
            body.clientRequestId,
            requestHash,
            body.fulfillment,
            cash,
            JSON.stringify(offered),
            JSON.stringify(requested),
            itemIds,
            true,
          ],
        );
        const conversation = await createConversation(
          db,
          userId,
          target.owner_id,
          null,
          tradeId,
        );
        await recordProposal(db, tradeId, userId, "proposed", {
          offered,
          requested,
          fulfillment: body.fulfillment,
          cashDifferenceCents: cash,
          revision: 1,
        });
        await addOfferMessage(
          db,
          conversation.id,
          userId,
          body.message,
          tradeId + ":intro",
        );
        await notify(
          db,
          target.owner_id,
          "New trade offer",
          `${offered[0].owner.name} sent you an offer for ${requested.length === 1 ? requested[0].title : requested.length + " items"}.`,
          `/trades/${tradeId}`,
        );
        return tradeId;
      });
      res
        .status(201)
        .json({ trade: await serializeTrade(pool, tradeId, userId) });
    }),
  );
  app.get(
    "/api/trades",
    wrap(async (req, res) => {
      const userId = requireUser(res),
        { limit, offset } = pagination(req);
      await expireOffers(pool, userId);
      const tab = z
        .enum(["open", "received", "sent", "accepted", "history"])
        .default("received")
        .parse(req.query.tab);
      const participantClause = "(sender_id=$1 OR recipient_id=$1)";
      const clauses = {
        open: "state IN ('pending','accepted','disputed')",
        received: "state='pending' AND proposed_by<>$1",
        sent: "state='pending' AND proposed_by=$1",
        accepted: "state IN ('accepted','disputed')",
        history: "state NOT IN ('pending','accepted','disputed')",
      };
      const rows = (
        await pool.query(
          `SELECT id FROM trade_offers WHERE ${participantClause} AND ${clauses[tab]} ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3`,
          [userId, limit + 1, offset],
        )
      ).rows;
      res.json(
        page(
          await Promise.all(rows.map((r) => serializeTrade(pool, r.id))),
          limit,
          offset,
        ),
      );
    }),
  );
  app.get(
    "/api/trades/:id",
    wrap(async (req, res) => {
      const userId = requireUser(res),
        tradeId = id.parse(req.params.id);
      await expireOffers(pool, userId);
      const t = (
        await pool.query(
          "SELECT sender_id,recipient_id FROM trade_offers WHERE id=$1",
          [tradeId],
        )
      ).rows[0];
      if (!t || ![t.sender_id, t.recipient_id].includes(userId))
        fail(404, "Trade not found.", "NOT_FOUND");
      res.json({ trade: await serializeTrade(pool, tradeId, userId) });
    }),
  );
  app.post(
    "/api/trades/:id/counter",
    wrap(async (req, res) => {
      const user = requireUser(res);
      const tradeId = id.parse(req.params.id);
      const body = counterOffer.parse(req.body);
      const itemIds = uniqueItems(
        body.offeredListingIds,
        body.requestedListingIds,
      );
      const digest = hash([tradeId, "counter", body]);
      await expireOffers(pool, user);
      await transaction(pool, async (db) => {
        const initial = await findTrade(db, tradeId, user);
        const other = otherParticipant(initial, user);
        await activePeople(db, [user, other], true);
        const current = await findTrade(db, tradeId, user);
        const items = await lockListings(db, [...current.item_ids, ...itemIds]);
        const trade = await findTrade(db, tradeId, user, true);
        if (await alreadyRan(db, user, body.clientRequestId, digest)) return;
        checkRevision(trade, body.expectedRevision);
        if (
          trade.state !== "pending" ||
          trade.expires_at.getTime() <= Date.now()
        )
          fail(409, "This offer is no longer open.", "TRADE_UNAVAILABLE");
        if (trade.proposed_by === user)
          fail(
            409,
            "Wait for a response or withdraw your current offer.",
            "WAITING_FOR_RESPONSE",
          );
        if (await blocked(db, user, other))
          fail(403, "These accounts cannot interact.", "BLOCKED");

        const yours = await snapshotItems(
          db,
          items,
          body.offeredListingIds,
          user,
          user,
        );
        const theirs = await snapshotItems(
          db,
          items,
          body.requestedListingIds,
          other,
          user,
        );
        const [offered, requested] =
          trade.sender_id === user ? [yours, theirs] : [theirs, yours];
        const cash = shippingDifference(
          offered,
          requested,
          body.fulfillment,
          body.balanceValues,
          shippingEnabled,
          body.cashAdjustmentCents,
        );
        if (
          trade.fulfillment === body.fulfillment &&
          trade.cash_difference_cents === cash &&
          itemIds.length === trade.item_ids.length &&
          itemIds.every((itemId) => trade.item_ids.includes(itemId))
        )
          fail(
            400,
            "Change the items or exchange method to send a counteroffer. You can also send a message.",
            "UNCHANGED_OFFER",
          );
        const revision = trade.revision + 1;
        await db.query(
          `UPDATE trade_offers SET offered_id=$2,requested_id=$3,offered_version=$4,requested_version=$5,
           offered_snapshot=$6,requested_snapshot=$7,offered_bundle=$8,requested_bundle=$9,item_ids=$10,
           fulfillment=$11,cash_difference_cents=$12,proposed_by=$13,revision=$14,plan_required=true,
           expires_at=now()+interval '7 days',updated_at=now() WHERE id=$1`,
          [
            tradeId,
            offered[0].id,
            requested[0].id,
            offered[0].version,
            requested[0].version,
            JSON.stringify(offered[0]),
            JSON.stringify(requested[0]),
            JSON.stringify(offered),
            JSON.stringify(requested),
            itemIds,
            body.fulfillment,
            cash,
            user,
            revision,
          ],
        );
        await recordProposal(db, tradeId, user, "countered", {
          offered,
          requested,
          fulfillment: body.fulfillment,
          cashDifferenceCents: cash,
          revision,
        });
        const conversation = await createConversation(
          db,
          user,
          other,
          null,
          tradeId,
        );
        await addOfferMessage(
          db,
          conversation.id,
          user,
          body.message,
          `${tradeId}:revision:${revision}`,
        );
        await saveCommand(db, user, body.clientRequestId, tradeId, digest);
        await notify(
          db,
          other,
          "New counteroffer",
          "Review the new items and terms in your trade.",
          `/trades/${tradeId}`,
        );
      });
      res.json({ trade: await serializeTrade(pool, tradeId, user) });
    }),
  );

  app.post(
    "/api/trades/:id/plan",
    wrap(async (req, res) => {
      const user = requireUser(res);
      const tradeId = id.parse(req.params.id);
      const body = planCommand.parse(req.body);
      await transaction(pool, async (db) => {
        const initial = await findTrade(db, tradeId, user);
        const other = otherParticipant(initial, user);
        await activePeople(db, [user, other], true);
        const trade = await findTrade(db, tradeId, user, true);
        if (trade.state !== "accepted" || trade.cancel_requested_by.length)
          fail(
            409,
            "This trade cannot change its exchange plan.",
            "TRADE_UNAVAILABLE",
          );
        if (await blocked(db, user, other))
          fail(403, "These accounts cannot interact.", "BLOCKED");

        const plan = trade.exchange_plan;
        if (body.action === "propose") {
          const method = trade.fulfillment;
          const protectedDeadline =
            method === "shipping"
              ? ((
                  await db.query(
                    "SELECT ship_by FROM trade_shipping WHERE trade_id=$1",
                    [tradeId],
                  )
                ).rows[0]?.ship_by as Date | undefined)
              : undefined;
          const details =
            method === "meetup"
              ? { place: body.place, time: body.time }
              : {
                  shipBy:
                    protectedDeadline?.toISOString().slice(0, 10) ??
                    body.shipBy,
                };
          if (Object.values(details).some((value) => !value))
            fail(
              400,
              method === "meetup"
                ? "Add a public meeting place and a time."
                : "Add a date to ship by.",
              "PLAN_DETAILS_REQUIRED",
            );
          if (
            plan?.proposedBy === user &&
            plan.version >= body.expectedVersion &&
            Object.entries(details).every(([key, value]) => plan[key] === value)
          )
            return;
          if ((plan?.version ?? 0) !== body.expectedVersion)
            fail(
              409,
              "The exchange plan changed. Review the latest plan.",
              "STALE_PLAN",
            );
          if (
            trade.confirmed_by.length ||
            Object.values<Shipment>(trade.shipments).some(
              (item) => item.tracking,
            )
          )
            fail(
              409,
              "The exchange has started. Use the conversation to coordinate.",
              "EXCHANGE_STARTED",
            );
          if (
            method === "arranged_shipping" &&
            body.shipBy! <
              new Date(Date.now() - 10 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10)
          )
            fail(
              400,
              "Choose a shipping date today or later.",
              "INVALID_SHIP_DATE",
            );
          const next = {
            ...details,
            version: body.expectedVersion + 1,
            proposedBy: user,
            confirmedBy: [user],
          };
          await db.query(
            "UPDATE trade_offers SET exchange_plan=$2,updated_at=now() WHERE id=$1",
            [tradeId, JSON.stringify(next)],
          );
          await event(db, tradeId, user, "plan_proposed");
          await notify(
            db,
            other,
            "Exchange plan proposed",
            "Review the plan and confirm when it works for you.",
            `/trades/${tradeId}`,
          );
        } else {
          if (!plan || plan.version !== body.expectedVersion)
            fail(
              409,
              "The exchange plan changed. Review the latest plan.",
              "STALE_PLAN",
            );
          if (plan.confirmedBy.includes(user)) return;
          plan.confirmedBy.push(user);
          await db.query(
            "UPDATE trade_offers SET exchange_plan=$2,updated_at=now() WHERE id=$1",
            [tradeId, JSON.stringify(plan)],
          );
          await event(db, tradeId, user, "plan_confirmed");
          await notify(
            db,
            other,
            "Exchange plan confirmed",
            "You both agreed to the exchange plan.",
            `/trades/${tradeId}`,
          );
        }
      });
      res.json({ trade: await serializeTrade(pool, tradeId, user) });
    }),
  );

  app.post(
    "/api/trades/:id/shipment",
    wrap(async (req, res) => {
      const user = requireUser(res);
      const tradeId = id.parse(req.params.id);
      const body = shipmentCommand.parse(req.body);
      await transaction(pool, async (db) => {
        const initial = await findTrade(db, tradeId, user);
        const other = otherParticipant(initial, user);
        await activePeople(db, [user, other], true);
        const trade = await findTrade(db, tradeId, user, true);
        if (
          trade.state !== "accepted" ||
          trade.fulfillment !== "arranged_shipping" ||
          trade.exchange_plan?.confirmedBy.length !== 2 ||
          trade.cancel_requested_by.length
        )
          fail(
            409,
            "Confirm the shipping plan before adding shipping details.",
            "PLAN_NOT_CONFIRMED",
          );
        if (await blocked(db, user, other))
          fail(403, "These accounts cannot interact.", "BLOCKED");

        const own: Shipment = trade.shipments[user] ?? {};
        const theirs: Shipment = trade.shipments[other] ?? {};
        if (body.action === "address") {
          if (hash(own.address ?? null) === hash(body.address)) return;
          if (theirs.tracking)
            fail(
              409,
              "The other parcel has already shipped to your saved address.",
              "EXCHANGE_STARTED",
            );
          own.address = body.address;
        } else {
          const tracking = {
            carrier: body.carrier,
            code: body.code.toUpperCase(),
          };
          if (
            own.tracking?.code === tracking.code &&
            own.tracking.carrier === tracking.carrier
          )
            return;
          if (!own.address || !theirs.address)
            fail(
              409,
              "Both people need to share receiving addresses first.",
              "ADDRESS_REQUIRED",
            );
          if (trade.confirmed_by.length)
            fail(
              409,
              "Receipt has already been confirmed.",
              "EXCHANGE_STARTED",
            );
          if (theirs.tracking?.code === tracking.code)
            fail(
              400,
              "Enter the tracking number for your own parcel.",
              "DUPLICATE_TRACKING",
            );
          own.tracking = tracking;
        }
        await db.query(
          "UPDATE trade_offers SET shipments=jsonb_set(shipments,ARRAY[$2::text],$3),updated_at=now() WHERE id=$1",
          [tradeId, user, JSON.stringify(own)],
        );
        await event(
          db,
          tradeId,
          user,
          body.action === "address" ? "address_shared" : "tracking_added",
        );
        await notify(
          db,
          other,
          body.action === "address"
            ? "Receiving address shared"
            : "Tracking added",
          "Open your trade to see the latest shipping details.",
          `/trades/${tradeId}`,
        );
      });
      res.json({ trade: await serializeTrade(pool, tradeId, user) });
    }),
  );

  app.post(
    "/api/trades/:id/actions",
    wrap(async (req, res) => {
      const userId = requireUser(res),
        tradeId = id.parse(req.params.id);
      const body = z
        .object({
          action: z.enum([
            "accept",
            "decline",
            "withdraw",
            "confirm",
            "cancel",
            "dispute",
          ]),
          clientRequestId: clientKey,
          reason: z.string().trim().max(500).optional(),
          expectedRevision: z.number().int().positive().optional(),
          planVersion: z.number().int().positive().optional(),
        })
        .strict()
        .parse(req.body);
      if (body.action === "dispute" && (!body.reason || body.reason.length < 3))
        fail(
          400,
          "Describe the problem so support can review it.",
          "REASON_REQUIRED",
        );
      await expireOffers(pool, userId);
      await transaction(pool, async (db) => {
        const initial = await findTrade(db, tradeId, userId);
        await activePeople(db, [initial.sender_id, initial.recipient_id], true);
        const current = await findTrade(db, tradeId, userId);
        const items = await lockListings(db, current.item_ids);
        const t = await findTrade(db, tradeId, userId, true);
        const commandHash = hash([
          tradeId,
          body.action,
          body.reason ?? "",
          ...(body.expectedRevision || body.planVersion
            ? [body.expectedRevision, body.planVersion]
            : []),
        ]);
        if (await alreadyRan(db, userId, body.clientRequestId, commandHash))
          return;
        const pendingAction = ["accept", "decline", "withdraw"].includes(
          body.action,
        );
        if (
          pendingAction &&
          (t.revision > 1 || body.expectedRevision !== undefined)
        )
          checkRevision(t, body.expectedRevision);
        const recipient = t.proposed_by !== userId;
        const other = otherParticipant(t, userId);
        // A retry with a fresh key must not record another participant
        // confirmation or move the terminal event away from the end of history.
        const repeatedConfirmation =
          body.action === "confirm" &&
          ["accepted", "completed"].includes(t.state) &&
          t.confirmed_by.includes(userId);
        const repeatedCancellation =
          body.action === "cancel" &&
          ["accepted", "canceled"].includes(t.state) &&
          t.cancel_requested_by.includes(userId);
        if (repeatedConfirmation || repeatedCancellation) {
          await db.query(
            "INSERT INTO trade_commands(actor_id,client_request_id,trade_id,request_hash) VALUES($1,$2,$3,$4)",
            [userId, body.clientRequestId, tradeId, commandHash],
          );
          return;
        }
        // Invalid actions roll back this event with the rest of the transaction.
        // Recording it first makes completed/canceled the final outcome event.
        const shipped = t.fulfillment === "shipping";
        if (
          shipped &&
          ["accept", "confirm", "cancel"].includes(body.action) &&
          !shippingEnabled
        )
          fail(
            409,
            "Shipped trades are temporarily unavailable.",
            "SHIPPING_UNAVAILABLE",
          );
        if (
          shipped &&
          t.state === "accepted" &&
          ["confirm", "cancel", "dispute"].includes(body.action)
        )
          await validateShippingAction(
            db,
            t as Parameters<typeof validateShippingAction>[1],
            userId,
            body.action,
          );
        if (body.action === "confirm" && t.state === "accepted") {
          if (t.cancel_requested_by.length)
            fail(
              409,
              "Resolve the cancellation request before confirming receipt.",
              "CANCELLATION_PENDING",
            );
          if (
            t.plan_required &&
            (!t.exchange_plan ||
              t.exchange_plan.confirmedBy.length !== 2 ||
              body.planVersion !== t.exchange_plan.version)
          )
            fail(
              409,
              "Both people must confirm the latest exchange plan first.",
              "PLAN_NOT_CONFIRMED",
            );
          if (
            t.fulfillment === "arranged_shipping" &&
            ![t.sender_id, t.recipient_id].every(
              (participant) => t.shipments[participant]?.tracking,
            )
          )
            fail(
              409,
              "Both people need to add tracking before confirming receipt.",
              "TRACKING_REQUIRED",
            );
        }
        if (
          body.action === "cancel" &&
          t.state === "accepted" &&
          (t.confirmed_by.length ||
            (t.fulfillment === "arranged_shipping" &&
              Object.values<Shipment>(t.shipments).some(
                (shipment) => shipment.tracking,
              )))
        )
          fail(
            409,
            "Use Report a problem after an item has shipped or receipt was confirmed.",
            "EXCHANGE_STARTED",
          );
        await event(db, tradeId, userId, body.action, body.reason);
        if (body.action === "accept" || body.action === "decline") {
          if (!recipient)
            fail(
              403,
              "Only the person who received this offer can respond.",
              "FORBIDDEN",
            );
          if (t.state !== "pending" || t.expires_at.getTime() <= Date.now())
            fail(409, "This offer is no longer pending.", "TRADE_UNAVAILABLE");
          if (body.action === "accept") {
            if (await blocked(db, t.sender_id, t.recipient_id))
              fail(403, "These accounts cannot interact.", "BLOCKED");
            for (const [bundle, owner] of [
              [t.offered_bundle, t.sender_id],
              [t.requested_bundle, t.recipient_id],
            ] as const) {
              if (
                !bundle.every((snapshot: Row) => {
                  const current = items.find((item) => item.id === snapshot.id);
                  return (
                    available(current, owner) &&
                    current!.version === snapshot.version
                  );
                })
              )
                fail(
                  409,
                  "An item changed or is no longer available. Refresh the trade.",
                  "ITEM_UNAVAILABLE",
                );
            }
            await db.query(
              "INSERT INTO reservations(listing_id,trade_id) SELECT item_id,$2 FROM unnest($1::uuid[]) AS items(item_id)",
              [t.item_ids, tradeId],
            );
            await db.query(
              "UPDATE listings SET status='reserved',updated_at=now() WHERE id=ANY($1::uuid[])",
              [t.item_ids],
            );
            await db.query(
              "UPDATE trade_offers SET state='accepted',updated_at=now() WHERE id=$1",
              [tradeId],
            );
            if (shipped)
              await setupShipping(db, t as Parameters<typeof setupShipping>[1]);
            await invalidateOffers(
              db,
              t.item_ids,
              "An item was reserved for another accepted trade.",
              tradeId,
            );
            await notify(
              db,
              other,
              "Trade accepted",
              shipped
                ? "The items are reserved. Set up shipping and authorize the agreed card holds."
                : "The items are reserved. Agree on your exchange plan together.",
              `/trades/${tradeId}`,
            );
          } else {
            await db.query(
              `UPDATE trade_offers SET state='declined',updated_at=now() WHERE id=$1`,
              [tradeId],
            );
            await notify(
              db,
              other,
              "Trade declined",
              "Your trade partner declined this offer.",
              `/trades/${tradeId}`,
            );
          }
        } else if (body.action === "withdraw") {
          if (recipient)
            fail(
              403,
              "Only the person who made this offer can withdraw it.",
              "FORBIDDEN",
            );
          if (t.state !== "pending")
            fail(
              409,
              "Only a pending offer can be withdrawn.",
              "TRADE_UNAVAILABLE",
            );
          await db.query(
            `UPDATE trade_offers SET state='withdrawn',updated_at=now() WHERE id=$1`,
            [tradeId],
          );
          await notify(
            db,
            other,
            "Trade withdrawn",
            "Your trade partner withdrew this offer.",
            `/trades/${tradeId}`,
          );
        } else if (body.action === "confirm") {
          if (t.state === "completed" && t.confirmed_by.includes(userId)) {
            /* safe retry with a fresh key */
          } else {
            if (t.state !== "accepted")
              fail(
                409,
                "Only an accepted trade can be confirmed.",
                "TRADE_UNAVAILABLE",
              );
            const confirmed = [...new Set([...t.confirmed_by, userId])];
            await db.query(
              "UPDATE trade_offers SET confirmed_by=$2,updated_at=now() WHERE id=$1",
              [tradeId, confirmed],
            );
            if (confirmed.length === 2 && shipped) {
              await queueShippingResolution(
                db,
                t as Parameters<typeof queueShippingResolution>[1],
                "completed",
              );
              await event(
                db,
                tradeId,
                userId,
                "settlement_requested",
                "Both participants confirmed receipt.",
              );
            } else if (confirmed.length === 2) {
              await finishTrade(db, t, "completed");
              await event(
                db,
                tradeId,
                userId,
                "completed",
                "Both participants confirmed their exchange.",
              );
              for (const person of [t.sender_id, t.recipient_id])
                await notify(
                  db,
                  person,
                  "Trade completed",
                  "Both participants confirmed. Your items moved to history and inventory slots are available.",
                  `/trades/${tradeId}`,
                );
            } else
              await notify(
                db,
                other,
                "Exchange confirmation requested",
                "The other participant confirmed completion. Confirm only after your exchange is complete.",
                `/trades/${tradeId}`,
              );
          }
        } else if (body.action === "cancel") {
          if (
            t.state === "canceled" &&
            t.cancel_requested_by.includes(userId)
          ) {
            /* safe retry */
          } else {
            if (t.state !== "accepted")
              fail(
                409,
                "Only an accepted trade can request mutual cancellation.",
                "TRADE_UNAVAILABLE",
              );
            const requested = [...new Set([...t.cancel_requested_by, userId])];
            await db.query(
              "UPDATE trade_offers SET cancel_requested_by=$2,updated_at=now() WHERE id=$1",
              [tradeId, requested],
            );
            if (requested.length === 2 && shipped) {
              await queueShippingResolution(
                db,
                t as Parameters<typeof queueShippingResolution>[1],
                "canceled",
              );
              await event(
                db,
                tradeId,
                userId,
                "settlement_requested",
                "Both participants agreed to cancel.",
              );
            } else if (requested.length === 2) {
              await finishTrade(db, t, "canceled");
              await event(
                db,
                tradeId,
                userId,
                "canceled",
                "Both participants agreed to cancel.",
              );
              for (const person of [t.sender_id, t.recipient_id])
                await notify(
                  db,
                  person,
                  "Trade canceled",
                  "Both participants agreed to cancel. The reserved items are available again.",
                  `/trades/${tradeId}`,
                );
            } else
              await notify(
                db,
                other,
                "Cancellation requested",
                "Both participants must agree before items are made available again.",
                `/trades/${tradeId}`,
              );
          }
        } else if (body.action === "dispute") {
          if (t.state !== "accepted")
            fail(
              409,
              "Only an accepted trade can be disputed.",
              "TRADE_UNAVAILABLE",
            );
          await db.query(
            `UPDATE trade_offers SET state='disputed',updated_at=now() WHERE id=$1`,
            [tradeId],
          );
          await db.query(
            "INSERT INTO reports(id,reporter_id,target_type,target_id,reason) VALUES($1,$2,$3,$4,$5)",
            [uuid(), userId, "trade", tradeId, body.reason],
          );
          for (const person of [t.sender_id, t.recipient_id])
            await notify(
              db,
              person,
              "Trade under review",
              "An exchange problem was reported. The items remain reserved until support records a resolution.",
              `/trades/${tradeId}`,
            );
        }
        await saveCommand(
          db,
          userId,
          body.clientRequestId,
          tradeId,
          commandHash,
        );
      });
      res.json({ trade: await serializeTrade(pool, tradeId, userId) });
    }),
  );
}
