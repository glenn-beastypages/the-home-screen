import type { Express, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
  type DB,
  activePeople,
  blocked,
  event,
  fail,
  hash,
  id,
  lockListings,
  notify,
  transaction,
  uuid,
  wrap,
} from "./common.js";
import { finalizeTrade } from "./trade-lifecycle.js";
import {
  parcelSize,
  shippingAddress,
  type Hold,
  type ShippingAddress,
  type ShippingProviders,
  type ShippingRate,
  type Tracking,
} from "./shipped-providers.js";

const day = 24 * 60 * 60 * 1000;
const minAuthorization = 12 * day;
const minAtDispatch = 8 * day;
const reviewLeadTime = day;
export const maxShippedValue = 500000;

type ShippingTrade = {
  id: string;
  state: string;
  fulfillment: string;
  sender_id: string;
  recipient_id: string;
  item_ids: string[];
  offered_bundle: { id: string; priceCents: number | null }[];
  requested_bundle: { id: string; priceCents: number | null }[];
  cash_difference_cents: number;
  plan_required: boolean;
  exchange_plan: { confirmedBy: string[] } | null;
};
type Shipping = {
  trade_id: string;
  ship_by: Date;
  resolution: "completed" | "canceled" | null;
  charge_party: string | null;
  charge_cents: number;
  settlement_error: boolean;
};
type Party = {
  user_id: string;
  security_cents: number;
  cash_cents: number;
  address: ShippingAddress | null;
  checkout_key: string;
  checkout_id: string | null;
  hold_status: Hold["status"] | "none" | "too_short";
  hold_until: Date | null;
  captured_cents: number;
  quote_id: string | null;
  quote_rates: ShippingRate[] | null;
  label_rate: string | null;
  label_url: string | null;
  tracker_id: string | null;
  carrier: string | null;
  tracking_code: string | null;
  tracking_status: string | null;
  payout_id: string | null;
  payout_ready: boolean | null;
};
type Context = { trade: ShippingTrade; shipping: Shipping; parties: Party[] };

const total = (p: Party) => p.security_cents + p.cash_cents;
const tracked = (p: Party) => Boolean(p.tracker_id || p.label_rate);
const inHand = (p: Party) =>
  [
    "in_transit",
    "out_for_delivery",
    "delivered",
    "available_for_pickup",
  ].includes(p.tracking_status ?? "");
const authorized = (p: Party, minimum = 0) =>
  p.hold_status === "authorized" &&
  (p.hold_until?.getTime() ?? 0) > Date.now() + minimum;
const readyToDispatch = ({ trade, shipping, parties }: Context) =>
  trade.state === "accepted" &&
  !shipping.resolution &&
  shipping.ship_by.getTime() > Date.now() &&
  parties.every((p) => p.address && authorized(p, minAtDispatch));
const outcomeOpen = ({ trade, shipping }: Context) =>
  trade.state === "accepted" && !shipping.resolution;

async function shippingContext(db: DB, trade: ShippingTrade): Promise<Context> {
  const shipping: Shipping = (
    await db.query("SELECT * FROM trade_shipping WHERE trade_id=$1", [trade.id])
  ).rows[0];
  if (!shipping)
    fail(
      409,
      "Accept this trade before setting up shipping.",
      "SHIPPING_NOT_ACCEPTED",
    );
  const parties: Party[] = (
    await db.query(
      `SELECT p.*, a.account_id AS payout_id, a.ready AS payout_ready
     FROM trade_shipping_parties p LEFT JOIN trade_payout_accounts a ON a.user_id=p.user_id
     WHERE trade_id=$1 ORDER BY p.user_id`,
      [trade.id],
    )
  ).rows;
  return { trade, shipping, parties };
}

export async function shippingReview(db: DB, tradeId: string) {
  const result = await db.query(
    `SELECT p.user_id AS "userId",p.carrier,p.tracking_code AS "trackingCode",
     p.tracking_status AS "trackingStatus",p.hold_status AS "holdStatus",p.hold_until AS "holdUntil",
     p.security_cents AS "securityCents",p.cash_cents AS "cashCents",p.captured_cents AS "capturedCents",
     s.resolution,s.settlement_error AS "settlementError"
     FROM trade_shipping_parties p JOIN trade_shipping s ON s.trade_id=p.trade_id WHERE p.trade_id=$1`,
    [tradeId],
  );
  return result.rows;
}

export async function setupShipping(db: DB, trade: ShippingTrade) {
  const offered = trade.offered_bundle.reduce(
    (sum, item) => sum + item.priceCents!,
    0,
  );
  const requested = trade.requested_bundle.reduce(
    (sum, item) => sum + item.priceCents!,
    0,
  );
  await db.query("INSERT INTO trade_shipping(trade_id) VALUES($1)", [trade.id]);
  await db.query(
    `INSERT INTO trade_shipping_parties(trade_id,user_id,security_cents,cash_cents,checkout_key)
     VALUES($1,$2,$3,$4,$5),($1,$6,$7,$8,$9)`,
    [
      trade.id,
      trade.sender_id,
      requested,
      requested > offered ? trade.cash_difference_cents : 0,
      uuid(),
      trade.recipient_id,
      offered,
      offered > requested ? trade.cash_difference_cents : 0,
      uuid(),
    ],
  );
}

export async function validateShippingAction(
  db: DB,
  trade: ShippingTrade,
  userId: string,
  action: string,
) {
  const ctx = await shippingContext(db, trade);
  if (ctx.shipping.resolution)
    fail(
      409,
      "This trade is settling. Refresh for its latest status.",
      "SETTLING",
    );
  if (action === "confirm") {
    if (!ctx.parties.every((p) => authorized(p)))
      fail(
        409,
        "The card holds need review before this trade can close.",
        "AUTHORIZATION_EXPIRED",
      );
    if (
      ctx.parties.find((p) => p.user_id !== userId)?.tracking_status !==
      "delivered"
    )
      fail(
        409,
        "Confirm receipt after your incoming parcel is marked delivered.",
        "DELIVERY_REQUIRED",
      );
  }
  if (action === "cancel" && ctx.parties.some(tracked))
    fail(
      409,
      "A parcel is in progress. Report a problem so support can review the exchange.",
      "SHIPPING_STARTED",
    );
}

export async function queueShippingResolution(
  db: DB,
  trade: ShippingTrade,
  resolution: "completed" | "canceled",
  compensation?: { userId: string; cents: number },
) {
  const ctx = await shippingContext(db, trade);
  if (ctx.shipping.resolution && !ctx.shipping.settlement_error)
    fail(409, "The previous resolution is still settling.", "SETTLING");
  if (ctx.parties.some((p) => p.captured_cents > 0))
    fail(
      409,
      "A payment has already been collected. Reconcile it with support.",
      "PAYMENT_COLLECTED",
    );
  if (
    resolution === "completed" &&
    !ctx.parties.every((p) => p.tracking_status === "delivered")
  )
    fail(
      409,
      "Both parcels must be delivered to complete a shipped trade.",
      "DELIVERY_REQUIRED",
    );
  if (compensation) {
    const p = ctx.parties.find((p) => p.user_id === compensation.userId);
    const beneficiary = ctx.parties.find(
      (party) => party.user_id !== compensation.userId,
    );
    if (
      !p ||
      !authorized(p) ||
      !beneficiary ||
      !inHand(beneficiary) ||
      compensation.cents > p.security_cents ||
      resolution !== "canceled" ||
      trade.state !== "disputed"
    )
      fail(
        409,
        "Compensation requires a carrier scan for the recipient and must fit the active security hold.",
        "INVALID_COMPENSATION",
      );
  }
  await db.query(
    `UPDATE trade_shipping SET resolution=$2,charge_party=$3,charge_cents=$4,settlement_error=false,
     checked_at=now()-interval '1 day' WHERE trade_id=$1`,
    [
      trade.id,
      resolution,
      compensation?.userId ?? null,
      compensation?.cents ?? 0,
    ],
  );
}

function shippingView(
  ctx: Context,
  userId: string,
  providers: ShippingProviders,
) {
  const { trade, shipping, parties } = ctx;
  const own = parties.find((p) => p.user_id === userId)!;
  const other = parties.find((p) => p.user_id !== userId)!;
  const active = outcomeOpen(ctx);
  const ready = readyToDispatch(ctx);
  const canContinueLabel =
    active &&
    Boolean(own.label_rate && !own.tracker_id) &&
    parties.every((p) => authorized(p));
  return {
    tradeState: trade.state,
    mode: providers.mode,
    labelBudgetCents: providers.labelBudgetCents,
    shipBy: shipping.ship_by.toISOString(),
    resolving: shipping.resolution,
    settlementError: shipping.settlement_error,
    active,
    readyToShip: ready,
    canContinueLabel,
    canConfirm:
      active &&
      parties.every((p) => authorized(p)) &&
      other.tracking_status === "delivered",
    canCancel: active && !parties.some(tracked),
    canEditAddress: active && !parties.some((p) => p.checkout_id || tracked(p)),
    canAuthorize:
      active &&
      Boolean(other.payout_ready) &&
      parties.every((p) => p.address) &&
      shipping.ship_by.getTime() > Date.now() &&
      !authorized(own) &&
      !tracked(own),
    own: {
      userId,
      address: own.address,
      payoutReady: Boolean(own.payout_ready),
      securityCents: own.security_cents,
      cashCents: own.cash_cents,
      holdStatus: own.hold_status,
      holdUntil: own.hold_until?.toISOString() ?? null,
      capturedCents: own.captured_cents,
      quoteRates: own.quote_rates ?? [],
      selectedRate: own.label_rate,
      labelUrl: own.label_url,
      carrier: own.carrier,
      trackingCode: own.tracking_code,
      trackingStatus: own.tracking_status,
    },
    other: {
      userId: other.user_id,
      addressSaved: Boolean(other.address),
      payoutReady: Boolean(other.payout_ready),
      securityCents: other.security_cents,
      cashCents: other.cash_cents,
      holdStatus: other.hold_status,
      holdUntil: other.hold_until?.toISOString() ?? null,
      capturedCents: other.captured_cents,
      carrier: other.carrier,
      trackingCode: other.tracking_code,
      trackingStatus: other.tracking_status,
    },
    destination: ready && !tracked(own) ? other.address : null,
  };
}

async function syncHold(
  db: DB,
  ctx: Context,
  p: Party,
  providers: ShippingProviders,
) {
  if (!p.checkout_id) return;
  let hold = await providers.hold(p.checkout_id, total(p));
  const tooShort =
    hold.status === "authorized" &&
    p.hold_status !== "authorized" &&
    (hold.until?.getTime() ?? 0) < Date.now() + minAuthorization &&
    !ctx.shipping.resolution;
  if (tooShort) hold = await providers.settleHold(p.checkout_id, total(p), 0);
  const status =
    tooShort && ["released", "expired"].includes(hold.status)
      ? "too_short"
      : hold.status;
  const next =
    p.hold_status === "too_short" && status === "released"
      ? "too_short"
      : status;
  await db.query(
    "UPDATE trade_shipping_parties SET hold_status=$3,hold_until=$4,captured_cents=$5 WHERE trade_id=$1 AND user_id=$2",
    [ctx.trade.id, p.user_id, next, hold.until, hold.capturedCents],
  );
}

async function saveTracker(
  db: DB,
  tradeId: string,
  userId: string,
  tracker: Tracking,
  labelUrl: string | null = null,
) {
  await db.query(
    `UPDATE trade_shipping_parties SET tracker_id=$3,carrier=$4,tracking_code=$5,tracking_status=$6,label_url=COALESCE($7,label_url)
     WHERE trade_id=$1 AND user_id=$2`,
    [
      tradeId,
      userId,
      tracker.id,
      tracker.carrier,
      tracker.code,
      tracker.status,
      labelUrl,
    ],
  );
}

async function openShippingReview(db: DB, ctx: Context, reason: string) {
  if (ctx.trade.state !== "accepted") return;
  const tradeId = ctx.trade.id;
  await db.query(
    "UPDATE trade_offers SET state='disputed',updated_at=now() WHERE id=$1",
    [tradeId],
  );
  await event(db, tradeId, null, "shipping_review", reason);
  for (const person of ctx.parties)
    await notify(
      db,
      person.user_id,
      "Shipped trade needs review",
      reason,
      "/trades/" + tradeId,
    );
}

async function settle(db: DB, ctx: Context, providers: ShippingProviders) {
  const { trade, shipping } = ctx;
  if (!shipping.resolution || shipping.settlement_error) return;
  const resolution = shipping.resolution;
  const capture = (p: Party) =>
    shipping.charge_party === p.user_id
      ? shipping.charge_cents
      : resolution === "completed"
        ? p.cash_cents
        : 0;
  // Only one person can owe money. Resolve that authorization first, so a
  // rejected capture leaves the other authorization available for review.
  const parties = [...ctx.parties].sort((a, b) => capture(b) - capture(a));
  for (const p of parties) {
    const cents = capture(p);
    const result = p.checkout_id
      ? await providers.settleHold(p.checkout_id, total(p), cents)
      : ({ status: "released", until: null, capturedCents: 0 } as const);
    await db.query(
      "UPDATE trade_shipping_parties SET hold_status=$3,hold_until=$4,captured_cents=$5 WHERE trade_id=$1 AND user_id=$2",
      [trade.id, p.user_id, result.status, result.until, result.capturedCents],
    );
    const settled =
      cents > 0
        ? result.status === "captured" && result.capturedCents === cents
        : ["released", "expired"].includes(result.status);
    if (!settled) {
      if (["released", "expired", "captured"].includes(result.status)) {
        await db.query(
          "UPDATE trade_shipping SET settlement_error=true WHERE trade_id=$1",
          [trade.id],
        );
        await openShippingReview(
          db,
          ctx,
          "The payment provider could not settle the agreed amount. Support will review it.",
        );
      }
      return;
    }
  }
  const archived =
    resolution === "canceled"
      ? parties
          .filter(tracked)
          .flatMap((p) =>
            (p.user_id === trade.sender_id
              ? trade.offered_bundle
              : trade.requested_bundle
            ).map((item) => item.id),
          )
      : [];
  await finalizeTrade(db, trade, resolution, archived);
  await db.query(
    "UPDATE trade_shipping_parties SET address=NULL WHERE trade_id=$1",
    [trade.id],
  );
  await event(
    db,
    trade.id,
    null,
    resolution,
    resolution === "completed"
      ? "Both parcels were delivered and the agreed payment was settled."
      : "The shipping trade was closed and its card holds were resolved.",
  );
  for (const p of parties)
    await notify(
      db,
      p.user_id,
      resolution === "completed"
        ? "Shipped trade complete"
        : "Shipped trade closed",
      "Review your shipping and payment history in the trade.",
      "/trades/" + trade.id,
    );
}

async function reconcile(
  pool: Pool,
  tradeId: string,
  providers: ShippingProviders,
  userId?: string,
) {
  await transaction(pool, async (db) => {
    const initial: ShippingTrade = (
      await db.query("SELECT * FROM trade_offers WHERE id=$1", [tradeId])
    ).rows[0];
    if (
      !initial ||
      initial.fulfillment !== "shipping" ||
      (userId && ![initial.sender_id, initial.recipient_id].includes(userId))
    )
      fail(404, "Trade not found.", "NOT_FOUND");
    if (!["accepted", "disputed"].includes(initial.state)) return;
    await lockListings(db, initial.item_ids);
    const trade: ShippingTrade = (
      await db.query(
        "SELECT * FROM trade_offers WHERE id=$1 FOR NO KEY UPDATE",
        [tradeId],
      )
    ).rows[0];
    if (!["accepted", "disputed"].includes(trade.state)) return;
    let ctx = await shippingContext(db, trade);
    await db.query(
      "UPDATE trade_shipping SET checked_at=now() WHERE trade_id=$1",
      [tradeId],
    );
    if (ctx.shipping.resolution) return settle(db, ctx, providers);
    for (const p of ctx.parties) {
      if (p.payout_id && !p.payout_ready) {
        const ready = await providers.payoutReady(p.payout_id);
        await db.query(
          "UPDATE trade_payout_accounts SET ready=$2 WHERE user_id=$1",
          [p.user_id, ready],
        );
      }
      await syncHold(db, ctx, p, providers);
      if (p.tracker_id) {
        const tracker = await providers.tracking(p.tracker_id);
        if (
          tracker.firstScanAt &&
          Date.parse(tracker.firstScanAt) <
            ctx.shipping.ship_by.getTime() - 3 * day
        )
          tracker.status = "error";
        await saveTracker(db, tradeId, p.user_id, tracker);
      } else if (p.label_rate && p.quote_id) {
        const rate = p.quote_rates?.find((r) => r.id === p.label_rate);
        if (rate) {
          const recovered = await providers.label(p.quote_id, rate, false);
          if (recovered) {
            await saveTracker(
              db,
              tradeId,
              p.user_id,
              recovered.tracking,
              recovered.url,
            );
            await event(db, tradeId, p.user_id, "label_recovered");
          }
        }
      }
    }
    ctx = await shippingContext(db, trade);
    if (trade.state === "disputed") return;
    const overdue =
      ctx.shipping.ship_by.getTime() <= Date.now() &&
      !ctx.parties.every(inHand);
    if (overdue && !ctx.parties.some(tracked)) {
      await queueShippingResolution(db, trade, "canceled");
      return settle(db, await shippingContext(db, trade), providers);
    }
    if (
      overdue ||
      (ctx.parties.some(tracked) &&
        !ctx.parties.every((p) => authorized(p, reviewLeadTime))) ||
      ctx.parties.some((p) =>
        ["failure", "return_to_sender", "canceled", "error"].includes(
          p.tracking_status ?? "",
        ),
      )
    ) {
      await openShippingReview(
        db,
        ctx,
        "A parcel or authorization needs attention. Review both shipments before taking further action.",
      );
    }
  });
}

export function registerShippedTrades(
  app: Express,
  pool: Pool,
  requireUser: (res: Response) => string,
  providers: ShippingProviders | null,
  publicUrl: string,
) {
  app.get("/api/trade-options", (_req, res) =>
    res.json({
      shipping: Boolean(providers),
      maxShippedValue,
      mode: providers?.mode ?? null,
    }),
  );
  if (!providers) return () => Promise.resolve();
  let poll: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || poll) return;
    poll = (async () => {
      const due = (
        await pool.query(
          `SELECT s.trade_id FROM trade_shipping s JOIN trade_offers t ON t.id=s.trade_id
         WHERE t.state IN ('accepted','disputed') AND NOT s.settlement_error
         AND s.checked_at<now()-interval '45 seconds'
         ORDER BY s.checked_at LIMIT 12`,
        )
      ).rows;
      for (const row of due) {
        if (stopped) break;
        try {
          await reconcile(pool, row.trade_id, providers);
        } catch {
          // Retry durable state without logging personal addresses or provider responses.
          await pool.query(
            "UPDATE trade_shipping SET checked_at=now() WHERE trade_id=$1",
            [row.trade_id],
          );
        }
      }
    })()
      .catch(() => console.error("Shipped trade reconciliation will retry."))
      .finally(() => {
        poll = null;
      });
  };
  const timer = setInterval(tick, 15_000);
  timer.unref();

  async function participant(
    db: DB,
    tradeId: string,
    userId: string,
    lock = false,
  ) {
    const trade: ShippingTrade = (
      await db.query(
        "SELECT * FROM trade_offers WHERE id=$1" +
          (lock ? " FOR NO KEY UPDATE" : ""),
        [tradeId],
      )
    ).rows[0];
    if (
      !trade ||
      trade.fulfillment !== "shipping" ||
      ![trade.sender_id, trade.recipient_id].includes(userId)
    )
      fail(404, "Trade not found.", "NOT_FOUND");
    return trade;
  }

  app.get(
    "/api/trades/:id/shipping",
    wrap(async (req, res) => {
      const userId = requireUser(res);
      const trade = await participant(pool, id.parse(req.params.id), userId);
      const ctx = await shippingContext(pool, trade);
      res.json(shippingView(ctx, userId, providers));
    }),
  );
  app.post(
    "/api/trades/:id/shipping/refresh",
    wrap(async (req, res) => {
      const userId = requireUser(res),
        tradeId = id.parse(req.params.id);
      await reconcile(pool, tradeId, providers, userId);
      const trade = await participant(pool, tradeId, userId);
      res.json(
        shippingView(await shippingContext(pool, trade), userId, providers),
      );
    }),
  );

  const commands = z.discriminatedUnion("action", [
    z.object({ action: z.literal("payout") }).strict(),
    z
      .object({ action: z.literal("address"), address: shippingAddress })
      .strict(),
    z.object({ action: z.literal("authorize") }).strict(),
    z
      .object({
        action: z.literal("track"),
        carrier: z.enum(["USPS", "UPS", "FedEx", "DHLExpress"]),
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{7,40}$/),
      })
      .strict(),
    z.object({ action: z.literal("quote"), parcel: parcelSize }).strict(),
    z
      .object({
        action: z.literal("label"),
        rateId: z.string().min(1).max(100),
      })
      .strict(),
  ]);

  app.post(
    "/api/trades/:id/shipping",
    wrap(async (req, res) => {
      const userId = requireUser(res),
        tradeId = id.parse(req.params.id),
        body = commands.parse(req.body);
      const returnUrl = publicUrl + "/trades/" + tradeId + "?shipping=return";
      const result = await transaction(pool, async (db) => {
        const initial = await participant(db, tradeId, userId);
        await activePeople(db, [initial.sender_id, initial.recipient_id], true);
        const trade = await participant(db, tradeId, userId, true);
        if (await blocked(db, trade.sender_id, trade.recipient_id))
          fail(
            403,
            "This trade needs support review before shipping.",
            "BLOCKED",
          );
        const ctx = await shippingContext(db, trade);
        if (
          trade.plan_required &&
          trade.exchange_plan?.confirmedBy.length !== 2
        )
          fail(
            409,
            "Both people need to confirm the shipping plan first.",
            "PLAN_NOT_CONFIRMED",
          );
        if (!outcomeOpen(ctx))
          fail(
            409,
            "This trade is closed or under review.",
            "TRADE_UNAVAILABLE",
          );
        const own = ctx.parties.find((p) => p.user_id === userId)!;
        const other = ctx.parties.find((p) => p.user_id !== userId)!;
        if (body.action === "payout") {
          const account =
            own.payout_id ??
            (await providers.createPayout("bsty-connect-" + hash(userId)));
          await db.query(
            "INSERT INTO trade_payout_accounts(user_id,account_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
            [userId, account],
          );
          const ready = await providers.payoutReady(account);
          await db.query(
            "UPDATE trade_payout_accounts SET ready=$2 WHERE user_id=$1",
            [userId, ready],
          );
          return ready
            ? {}
            : { url: await providers.payoutLink(account, returnUrl) };
        }
        if (body.action === "address") {
          if (ctx.parties.some((p) => p.checkout_id || tracked(p)))
            fail(
              409,
              "Your address is locked after checkout starts.",
              "ADDRESS_LOCKED",
            );
          await db.query(
            "UPDATE trade_shipping_parties SET address=$3 WHERE trade_id=$1 AND user_id=$2",
            [tradeId, userId, body.address],
          );
          return {};
        }
        if (body.action === "authorize") {
          if (
            !ctx.parties.every((p) => p.address) ||
            !other.payout_id ||
            !(await providers.payoutReady(other.payout_id)) ||
            ctx.shipping.ship_by.getTime() <= Date.now() ||
            tracked(own)
          )
            fail(
              409,
              "Both addresses and the other person's payout setup are required.",
              "SHIPPING_SETUP_REQUIRED",
            );
          if (own.checkout_id) {
            const hold = await providers.hold(own.checkout_id, total(own));
            if (hold.status === "authorized") return {};
            if (hold.status === "checkout" && hold.url)
              return { url: hold.url };
            if (!["expired", "released"].includes(hold.status))
              fail(
                409,
                "The previous authorization needs review.",
                "SHIPPING_SETUP_REQUIRED",
              );
          }
          const key = own.checkout_id ? own.checkout_id : own.checkout_key;
          const checkout = await providers.createHold({
            key: "bsty-hold-" + key,
            cents: total(own),
            destination: other.payout_id,
            returnUrl,
            tradeId,
          });
          await db.query(
            `UPDATE trade_shipping_parties SET checkout_id=$3,hold_status='checkout',hold_until=NULL
           WHERE trade_id=$1 AND user_id=$2`,
            [tradeId, userId, checkout.id],
          );
          return { url: checkout.url };
        }
        if (own.tracker_id) {
          if (body.action === "label" && own.label_rate === body.rateId)
            return {};
          if (
            body.action === "track" &&
            own.carrier?.toLowerCase() === body.carrier.toLowerCase() &&
            own.tracking_code === body.code
          )
            return {};
          fail(409, "This parcel already has tracking.", "PARCEL_LOCKED");
        }
        // Refresh both actual authorization windows before exposing a carrier
        // purchase or accepting new tracking. Client state alone is insufficient.
        for (const p of ctx.parties) await syncHold(db, ctx, p, providers);
        const updated = await shippingContext(db, trade);
        const retryLabel =
          body.action === "label" &&
          own.label_rate === body.rateId &&
          updated.parties.every((p) => authorized(p));
        if (!readyToDispatch(updated) && !retryLabel)
          fail(
            409,
            "Both card holds must be active with enough time to ship.",
            "HOLDS_REQUIRED",
          );
        if (body.action === "track") {
          if (own.label_rate)
            fail(
              409,
              "Recover the label already ordered for this parcel.",
              "LABEL_PENDING",
            );
          const tracker = await providers.track(body.carrier, body.code);
          if (
            tracker.firstScanAt &&
            new Date(tracker.firstScanAt).getTime() <
              ctx.shipping.ship_by.getTime() - 3 * day
          )
            fail(
              409,
              "This tracking number predates the trade.",
              "TRACKING_TOO_OLD",
            );
          await saveTracker(db, tradeId, userId, tracker);
          await event(db, tradeId, userId, "tracking_added");
          return {};
        }
        if (body.action === "quote") {
          if (!providers.labelBudgetCents || own.label_rate)
            fail(
              409,
              "Use your own postage or recover the existing label.",
              "LABEL_UNAVAILABLE",
            );
          const quote = await providers.quote(
            own.address!,
            other.address!,
            body.parcel,
          );
          await db.query(
            "UPDATE trade_shipping_parties SET quote_id=$3,quote_rates=$4 WHERE trade_id=$1 AND user_id=$2",
            [tradeId, userId, quote.id, JSON.stringify(quote.rates)],
          );
          return {};
        }
        const rate = own.quote_rates?.find((r) => r.id === body.rateId);
        if (
          !own.quote_id ||
          !rate ||
          rate.cents > providers.labelBudgetCents ||
          (own.label_rate && own.label_rate !== rate.id)
        )
          fail(409, "Choose an available postage rate.", "LABEL_UNAVAILABLE");
        await db.query(
          "UPDATE trade_shipping_parties SET label_rate=$3 WHERE trade_id=$1 AND user_id=$2",
          [tradeId, userId, rate.id],
        );
        return { buyLabel: { quoteId: own.quote_id, rate } };
      });
      if (result.buyLabel) {
        // Commit the chosen rate first. If the provider's response is lost,
        // retry the same shipment and recover its existing label.
        const order = result.buyLabel;
        await transaction(pool, async (db) => {
          const initial = await participant(db, tradeId, userId);
          await activePeople(
            db,
            [initial.sender_id, initial.recipient_id],
            true,
          );
          const trade = await participant(db, tradeId, userId, true);
          if (await blocked(db, trade.sender_id, trade.recipient_id))
            fail(
              403,
              "This trade needs support review before shipping.",
              "BLOCKED",
            );
          const ctx = await shippingContext(db, trade);
          const own = ctx.parties.find((p) => p.user_id === userId)!;
          if (own.tracker_id) return;
          if (
            !outcomeOpen(ctx) ||
            own.label_rate !== order.rate.id ||
            own.quote_id !== order.quoteId
          )
            fail(409, "The label needs support review.", "LABEL_UNAVAILABLE");
          const label = await providers.label(
            order.quoteId,
            order.rate,
            readyToDispatch(ctx),
          );
          if (!label)
            fail(
              409,
              "The shipping window closed before this label was purchased.",
              "LABEL_UNAVAILABLE",
            );
          await saveTracker(db, tradeId, userId, label.tracking, label.url);
          await event(db, tradeId, userId, "label_created");
        });
      }
      res.json({ url: result.url ?? null });
    }),
  );

  return async () => {
    stopped = true;
    clearInterval(timer);
    await poll;
  };
}
