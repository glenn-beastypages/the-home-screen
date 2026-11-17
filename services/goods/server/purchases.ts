import type { Express, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
  activePeople,
  blocked,
  clientKey,
  fail,
  id,
  invalidateOffers,
  lockListings,
  notify,
  transaction,
  uuid,
  wrap,
} from "./common.js";
import { createConversation } from "./trades.js";
import type { Checkout, PurchaseProvider } from "./purchase-provider.js";

type State =
  | "pending"
  | "canceled"
  | "paid"
  | "complete"
  | "refunding"
  | "refunded"
  | "refund_failed";
type Purchase = {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  title: string;
  price_cents: number;
  account_id: string;
  expires_at: Date;
  conversation_id: string;
  state: State;
  session_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
};

function view(row: Purchase, member: string) {
  return {
    id: row.id,
    listingId: row.listing_id,
    title: row.title,
    cents: row.price_cents,
    role: row.buyer_id === member ? "buyer" : "seller",
    conversationId: row.conversation_id,
    state: row.state,
    expiresAt: row.expires_at,
  };
}

export function registerPurchases(
  app: Express,
  pool: Pool,
  requireUser: (res: Response) => string,
  provider: PurchaseProvider | null,
  base: string,
) {
  app.get(
    "/api/purchases/options/:listingId",
    wrap(async (req, res) => {
      const listingId = id.parse(req.params.listingId);
      if (!provider) return void res.json({ available: false });
      const eligible = (
        await pool.query(
          `SELECT 1 FROM listings l JOIN purchase_sellers s ON s.seller_id=l.owner_id
       JOIN profiles p ON p.id=l.owner_id
       WHERE l.id=$1 AND s.ready AND p.status='active' AND l.status='active'
       AND l.published_at IS NOT NULL AND NOT l.is_demo AND NOT l.is_hidden
       AND NOT l.trade_enabled AND l.price_cents BETWEEN 50 AND 99999999`,
          [listingId],
        )
      ).rowCount;
      res.json({ available: Boolean(eligible) });
    }),
  );
  app.get("/api/purchases/options", (_req, res) =>
    res.json({ enabled: Boolean(provider) }),
  );
  if (!provider) return async () => {};
  const payments = provider;

  async function sync(orderId: string, action?: string, actor?: string) {
    const initial = (
      await pool.query<Purchase>("SELECT * FROM purchases WHERE id=$1", [
        orderId,
      ])
    ).rows[0];
    if (
      !initial ||
      (actor && ![initial.buyer_id, initial.seller_id].includes(actor))
    )
      fail(404, "Order unavailable.");
    return transaction(pool, async (db) => {
      const [listing] = await lockListings(db, [initial.listing_id]);
      let row = (
        await db.query<Purchase>(
          "SELECT * FROM purchases WHERE id=$1 FOR UPDATE",
          [orderId],
        )
      ).rows[0];
      let checkout: Checkout | null = null;
      const setState = async (
        state: State,
        payment: string | null = row.payment_id,
      ) => {
        row = (
          await db.query<Purchase>(
            "UPDATE purchases SET state=$2,payment_id=$3 WHERE id=$1 RETURNING *",
            [orderId, state, payment],
          )
        ).rows[0];
      };
      const cancel = async () => {
        const seller = (
          await db.query("SELECT status FROM profiles WHERE id=$1", [
            row.seller_id,
          ])
        ).rows[0];
        await db.query(
          "UPDATE listings SET status=$2,updated_at=now() WHERE id=$1 AND status='reserved'",
          [
            listing.id,
            !listing.is_hidden && seller?.status === "active"
              ? "active"
              : "archived",
          ],
        );
        await setState("canceled");
      };
      if (row.state === "pending") {
        if (!row.session_id) {
          // No URL was ever released to a browser before a provider ID was persisted.
          // Stripe requires a new session to have at least 30 minutes left.
          if (
            action === "cancel" ||
            row.expires_at.getTime() - Date.now() < 31 * 60_000
          ) {
            await cancel();
            return { row, url: null };
          }
          if (action !== "pay") return { row, url: null };
          checkout = await payments.checkout(row.account_id, {
            orderId,
            title: row.title,
            cents: row.price_cents,
            expiresAt: Math.floor(row.expires_at.getTime() / 1000),
            returnUrl: base + "/orders/" + orderId,
          });
        } else {
          checkout =
            action === "cancel"
              ? await payments.expire(row.account_id, row.session_id)
              : await payments.read(row.account_id, row.session_id);
        }
        if (
          checkout.orderId !== orderId ||
          checkout.cents !== row.price_cents ||
          (row.session_id && checkout.id !== row.session_id)
        )
          fail(502, "Payment details did not match this order.");
        if (!row.session_id) {
          row = (
            await db.query<Purchase>(
              "UPDATE purchases SET session_id=$2 WHERE id=$1 RETURNING *",
              [orderId, checkout.id],
            )
          ).rows[0];
        }
        if (checkout.state === "expired") await cancel();
        if (checkout.state === "paid" && checkout.payment) {
          await db.query(
            "UPDATE listings SET status='sold',version=version+1,updated_at=now() WHERE id=$1",
            [listing.id],
          );
          await invalidateOffers(
            db,
            [listing.id],
            "An item in this offer sold.",
          );
          await setState("paid", checkout.payment);
          await notify(
            db,
            row.seller_id,
            "Item sold",
            row.title,
            "/orders/" + row.id,
          );
          await notify(
            db,
            row.buyer_id,
            "Payment received",
            row.title,
            "/orders/" + row.id,
          );
        }
      }
      if (
        action === "complete" &&
        row.state === "paid" &&
        actor === row.buyer_id
      ) {
        await setState("complete");
        await notify(
          db,
          row.seller_id,
          "Pickup confirmed",
          row.title,
          "/orders/" + row.id,
        );
      }
      if (
        action === "refund" &&
        row.state === "paid" &&
        actor === row.seller_id &&
        row.payment_id
      ) {
        // Block pickup before issuing a refund, even if Stripe's response is lost.
        await setState("refunding");
        return { row, url: null };
      }
      if (row.state === "refunding" && row.payment_id && !row.refund_id) {
        const refund = await payments.refund(
          row.account_id,
          row.payment_id,
          row.id,
        );
        row = (
          await db.query<Purchase>(
            "UPDATE purchases SET refund_id=$2 WHERE id=$1 RETURNING *",
            [row.id, refund],
          )
        ).rows[0];
        return { row, url: null };
      }
      if (row.state === "refunding" && row.refund_id) {
        const status = await payments.refundStatus(
          row.account_id,
          row.refund_id,
        );
        if (status === "succeeded") {
          await setState("refunded");
          await notify(
            db,
            row.buyer_id,
            "Purchase refunded",
            row.title,
            "/orders/" + row.id,
          );
        } else if (status === "failed") {
          await setState("refund_failed");
          await notify(
            db,
            row.seller_id,
            "Refund needs attention",
            row.title,
            "/orders/" + row.id,
          );
        }
      }
      return {
        row,
        url:
          row.state === "pending" && checkout?.state === "open"
            ? checkout.url
            : null,
      };
    });
  }

  app.get(
    "/api/purchases",
    wrap(async (_req, res) => {
      const member = requireUser(res);
      const [orders, account] = await Promise.all([
        pool.query<Purchase>(
          "SELECT * FROM purchases WHERE buyer_id=$1 OR seller_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [member],
        ),
        pool.query("SELECT ready FROM purchase_sellers WHERE seller_id=$1", [
          member,
        ]),
      ]);
      res.json({
        orders: orders.rows.map((row) => view(row, member)),
        sellerReady: account.rows[0]?.ready === true,
      });
    }),
  );

  app.post(
    "/api/purchases/setup",
    wrap(async (req, res) => {
      const member = requireUser(res);
      const { refresh } = z
        .object({ refresh: z.boolean().default(false) })
        .strict()
        .parse(req.body);
      const result = await transaction(pool, async (db) => {
        await activePeople(db, [member], true);
        const existing = (
          await db.query(
            "SELECT account_id FROM purchase_sellers WHERE seller_id=$1",
            [member],
          )
        ).rows[0];
        if (refresh && !existing) return { ready: false };
        const account =
          existing?.account_id ?? (await payments.account(member));
        const ready = await payments.ready(account);
        await db.query(
          `INSERT INTO purchase_sellers(seller_id,account_id,ready) VALUES($1,$2,$3)
        ON CONFLICT(seller_id) DO UPDATE SET ready=EXCLUDED.ready`,
          [member, account, ready],
        );
        return {
          ready,
          url:
            !ready && !refresh
              ? await payments.onboarding(account, base + "/orders?setup=1")
              : undefined,
        };
      });
      res.json(result);
    }),
  );

  app.post(
    "/api/purchases",
    wrap(async (req, res) => {
      const buyer = requireUser(res);
      const body = z
        .object({
          listingId: id,
          version: z.number().int().positive(),
          requestId: clientKey,
        })
        .strict()
        .parse(req.body);
      const target = (
        await pool.query("SELECT owner_id FROM listings WHERE id=$1", [
          body.listingId,
        ])
      ).rows[0];
      if (!target || buyer === target.owner_id)
        fail(409, "This item is unavailable for checkout.");
      const orderId = await transaction(pool, async (db) => {
        const seller = target.owner_id as string;
        await activePeople(db, [buyer, seller], true);
        const [item] = await lockListings(db, [body.listingId]);
        const retry = (
          await db.query<Purchase>(
            "SELECT * FROM purchases WHERE buyer_id=$1 AND request_id=$2",
            [buyer, body.requestId],
          )
        ).rows[0];
        if (retry) {
          if (retry.listing_id !== body.listingId)
            fail(409, "This request belongs to a different listing.");
          return retry.id;
        }
        const active = (
          await db.query(
            "SELECT id,buyer_id FROM purchases WHERE listing_id=$1 AND state='pending'",
            [body.listingId],
          )
        ).rows[0];
        if (active?.buyer_id === buyer) return active.id as string;
        if (
          !item ||
          item.is_hidden ||
          item.is_demo ||
          item.trade_enabled ||
          item.status !== "active" ||
          !item.published_at ||
          item.version !== body.version ||
          item.price_cents < 50 ||
          item.price_cents > 99999999
        )
          fail(
            409,
            "The listing changed or is unavailable. Return to the listing to review it.",
          );
        if (await blocked(db, buyer, seller))
          fail(403, "These accounts cannot interact.");
        const account = (
          await db.query(
            "SELECT account_id FROM purchase_sellers WHERE seller_id=$1 AND ready",
            [seller],
          )
        ).rows[0];
        if (!account || !(await payments.ready(account.account_id)))
          fail(
            409,
            "The seller’s checkout is unavailable. Message the seller for help.",
          );
        const conversation = await createConversation(
          db,
          buyer,
          seller,
          item.id,
          null,
        );
        const key = uuid();
        await db.query(
          `INSERT INTO purchases(id,buyer_id,seller_id,listing_id,account_id,title,price_cents,request_id,conversation_id,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '1 hour')`,
          [
            key,
            buyer,
            seller,
            item.id,
            account.account_id,
            item.title,
            item.price_cents,
            body.requestId,
            conversation.id,
          ],
        );
        await db.query(
          "UPDATE listings SET status='reserved',updated_at=now() WHERE id=$1",
          [item.id],
        );
        return key;
      });
      // A flaky provider leaves the order visible in Orders where the buyer can retry.
      res.status(201).json({ id: orderId });
    }),
  );

  app.get(
    "/api/purchases/:id",
    wrap(async (req, res) => {
      const member = requireUser(res);
      const { row } = await sync(id.parse(req.params.id), undefined, member);
      res.json({ order: view(row, member) });
    }),
  );
  app.post(
    "/api/purchases/:id",
    wrap(async (req, res) => {
      const member = requireUser(res);
      const { action } = z
        .object({ action: z.enum(["pay", "cancel", "complete", "refund"]) })
        .strict()
        .parse(req.body);
      const orderId = id.parse(req.params.id);
      const row = (
        await pool.query<Purchase>("SELECT * FROM purchases WHERE id=$1", [
          orderId,
        ])
      ).rows[0];
      if (!row || ![row.buyer_id, row.seller_id].includes(member))
        fail(404, "Order unavailable.");
      if ((action === "refund" ? row.seller_id : row.buyer_id) !== member)
        fail(403, "This action is for the other participant.");
      const result = await sync(orderId, action, member);
      res.json({
        order: view(result.row, member),
        url: action === "pay" ? result.url : undefined,
      });
    }),
  );

  let pending: Promise<void> | undefined;
  let after = "";
  async function reconcile() {
    const due = await pool.query<{ id: string }>(
      "SELECT id FROM purchases WHERE state IN ('pending','refunding') AND id::text>$1 ORDER BY id LIMIT 20",
      [after],
    );
    after = due.rows.at(-1)?.id ?? "";
    for (const { id: key } of due.rows) {
      try {
        await sync(key);
      } catch {
        console.warn("A test purchase needs provider reconciliation.");
      }
    }
  }
  const timer = setInterval(() => {
    pending ??= reconcile()
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      });
  }, 20_000);
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
