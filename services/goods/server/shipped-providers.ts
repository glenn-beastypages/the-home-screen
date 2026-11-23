import { z } from "zod";
import { fail } from "./common.js";

export const shippingAddress = z
  .object({
    name: z.string().trim().min(2).max(80),
    street: z.string().trim().min(3).max(100),
    unit: z.string().trim().max(40).optional(),
    city: z.string().trim().min(2).max(80),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/,
      ),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/),
  })
  .strict();
export type ShippingAddress = z.infer<typeof shippingAddress>;

export const trackingReference = z
  .object({
    carrier: z.enum(["USPS", "UPS", "FedEx", "DHLExpress"]),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{7,40}$/),
  })
  .strict();

export const parcelSize = z
  .object({
    weight: z.number().min(1).max(1120),
    length: z.number().min(1).max(48),
    width: z.number().min(1).max(48),
    height: z.number().min(1).max(48),
  })
  .strict();
export type ParcelSize = z.infer<typeof parcelSize>;

export type Tracking = {
  id: string;
  carrier: string;
  code: string;
  status: string;
  firstScanAt: string | null;
};
export type ShippingRate = {
  id: string;
  carrier: string;
  service: string;
  cents: number;
};
export type Hold = {
  status: "checkout" | "authorized" | "expired" | "released" | "captured";
  until: Date | null;
  capturedCents: number;
  url?: string;
};

export interface ShippingProviders {
  mode: "test" | "live";
  labelBudgetCents: number;
  createPayout(key: string): Promise<string>;
  payoutReady(account: string): Promise<boolean>;
  payoutLink(account: string, returnUrl: string): Promise<string>;
  createHold(input: {
    key: string;
    cents: number;
    destination: string;
    returnUrl: string;
    tradeId: string;
  }): Promise<{ id: string; url: string }>;
  hold(id: string, cents: number): Promise<Hold>;
  settleHold(id: string, cents: number, captureCents: number): Promise<Hold>;
  track(carrier: string, code: string): Promise<Tracking>;
  tracking(id: string): Promise<Tracking>;
  quote(
    from: ShippingAddress,
    to: ShippingAddress,
    parcel: ParcelSize,
  ): Promise<{ id: string; rates: ShippingRate[] }>;
  label(
    quoteId: string,
    rate: ShippingRate,
    allowPurchase: boolean,
  ): Promise<{ url: string; tracking: Tracking } | null>;
}

const isLocal = (url: string) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
const stripeOrigin = "https://api.stripe.com/v1";
const easyPostOrigin = "https://api.easypost.com/v2";

export function shippingProviders(
  config: NodeJS.ProcessEnv,
  appUrl: string,
  injected?: ShippingProviders,
): ShippingProviders | null {
  if (injected) {
    if (
      config.NODE_ENV !== "test" ||
      !isLocal(appUrl) ||
      injected.mode !== "test"
    )
      throw new Error(
        "Injected trade providers are restricted to loopback tests.",
      );
    return injected;
  }
  const mode = config.GOODS_SHIPPED_TRADES;
  if (!mode || mode === "off") return null;
  if (mode !== "test" && mode !== "live")
    throw new Error("Invalid GOODS_SHIPPED_TRADES mode.");
  if (mode === "test" && (config.NODE_ENV === "production" || !isLocal(appUrl)))
    throw new Error(
      "Shipped trade test mode requires a loopback development host.",
    );
  if (
    mode === "live" &&
    (config.NODE_ENV !== "production" || !appUrl.startsWith("https://"))
  )
    throw new Error("Live shipped trades require a production HTTPS host.");
  const stripeKey = config.GOODS_STRIPE_SECRET_KEY ?? "";
  const easyPostKey = config.GOODS_EASYPOST_API_KEY ?? "";
  if (!stripeKey.startsWith("sk_" + mode + "_") || !easyPostKey)
    throw new Error(
      "Configure mode-matched Stripe and EasyPost credentials for shipped trades.",
    );
  const labelBudgetCents = Number(config.GOODS_LABEL_BUDGET_CENTS ?? "0");
  if (
    !Number.isSafeInteger(labelBudgetCents) ||
    labelBudgetCents < 0 ||
    labelBudgetCents > 10000
  )
    throw new Error("Invalid GOODS_LABEL_BUDGET_CENTS.");

  async function request<T>(
    origin: string,
    route: string,
    authorization: string,
    data?: URLSearchParams | object,
    key?: string,
  ): Promise<T> {
    try {
      const response = await fetch(origin + route, {
        method: data ? "POST" : "GET",
        headers: {
          Authorization: authorization,
          ...(data && {
            "Content-Type":
              data instanceof URLSearchParams
                ? "application/x-www-form-urlencoded"
                : "application/json",
          }),
          ...(key && { "Idempotency-Key": key }),
        },
        body:
          data instanceof URLSearchParams
            ? data
            : data
              ? JSON.stringify(data)
              : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return (await response.json()) as T;
    } catch {
      // Provider payloads can contain addresses and payment references.
    }
    fail(
      502,
      "The shipping or payment provider did not confirm this step. Refresh and try again.",
      "PROVIDER_UNAVAILABLE",
    );
  }

  type Intent = {
    id: string;
    status: string;
    amount: number;
    amount_capturable: number;
    amount_received: number;
    currency: string;
    capture_method: string;
    livemode: boolean;
    latest_charge?: {
      payment_method_details?: { card?: { capture_before?: number } };
    };
  };
  type Session = {
    id: string;
    status: string;
    url?: string;
    livemode: boolean;
    amount_total: number;
    currency: string;
    payment_intent: Intent | null;
  };
  type EasyTracker = {
    id: string;
    mode: string;
    tracking_code: string;
    carrier: string;
    status: string;
    tracking_details?: { datetime: string; status: string }[];
  };
  type EasyShipment = {
    id: string;
    mode: string;
    postage_label?: { label_url?: string };
    selected_rate?: { id: string; rate: string; currency: string };
    tracker?: EasyTracker;
    rates: {
      id: string;
      carrier: string;
      service: string;
      rate: string;
      currency: string;
    }[];
  };

  function stripe<T>(
    route: string,
    data?: Record<string, string>,
    key?: string,
  ) {
    return request<T>(
      stripeOrigin,
      route,
      "Bearer " + stripeKey,
      data ? new URLSearchParams(data) : undefined,
      key,
    );
  }
  function easy<T>(route: string, data?: object) {
    return request<T>(
      easyPostOrigin,
      route,
      "Basic " + Buffer.from(easyPostKey + ":").toString("base64"),
      data,
    );
  }
  const sessionPath = (id: string) =>
    "/checkout/sessions/" + encodeURIComponent(id);
  async function session(id: string, cents: number) {
    const result = await stripe<Session>(
      sessionPath(id) + "?expand[]=payment_intent.latest_charge",
    );
    const intent = result.payment_intent;
    if (
      result.livemode !== (mode === "live") ||
      result.amount_total !== cents ||
      result.currency !== "usd" ||
      (intent &&
        (intent.livemode !== result.livemode ||
          intent.amount !== cents ||
          intent.currency !== "usd" ||
          intent.capture_method !== "manual"))
    )
      fail(
        502,
        "The provider returned different authorization terms.",
        "PROVIDER_MISMATCH",
      );
    return result;
  }
  function holdStatus(s: Session): Hold {
    const pi = s.payment_intent;
    const until =
      pi?.latest_charge?.payment_method_details?.card?.capture_before;
    if (
      pi?.status === "requires_capture" &&
      pi.amount_capturable === s.amount_total &&
      until
    )
      return {
        status: "authorized",
        until: new Date(until * 1000),
        capturedCents: 0,
      };
    if (pi?.status === "succeeded")
      return {
        status: "captured",
        until: null,
        capturedCents: pi.amount_received,
      };
    if (pi?.status === "canceled")
      return { status: "released", until: null, capturedCents: 0 };
    if (s.status === "expired")
      return { status: "expired", until: null, capturedCents: 0 };
    return { status: "checkout", until: null, capturedCents: 0, url: s.url };
  }
  function assertShippingMode(actual: string) {
    if (actual !== (mode === "live" ? "production" : "test"))
      fail(
        502,
        "The carrier provider returned the wrong environment.",
        "PROVIDER_MISMATCH",
      );
  }
  function mapTracker(t: EasyTracker): Tracking {
    assertShippingMode(t.mode);
    const scans = (t.tracking_details ?? [])
      .filter(
        (d) =>
          !["unknown", "pre_transit"].includes(d.status) &&
          Number.isFinite(Date.parse(d.datetime)),
      )
      .map((d) => new Date(d.datetime).toISOString())
      .sort();
    return {
      id: t.id,
      carrier: t.carrier,
      code: t.tracking_code,
      status: t.status,
      firstScanAt: scans[0] ?? null,
    };
  }
  const address = (a: ShippingAddress) => ({
    name: a.name,
    street1: a.street,
    street2: a.unit ?? "",
    city: a.city,
    state: a.state,
    zip: a.zip,
    country: "US",
  });

  return {
    mode,
    labelBudgetCents,
    async createPayout(key) {
      const a = await stripe<{ id: string }>(
        "/accounts",
        {
          type: "express",
          country: "US",
          "capabilities[transfers][requested]": "true",
        },
        key,
      );
      return a.id;
    },
    async payoutReady(id) {
      const a = await stripe<{
        payouts_enabled: boolean;
        capabilities?: { transfers?: string };
      }>("/accounts/" + encodeURIComponent(id));
      return a.payouts_enabled && a.capabilities?.transfers === "active";
    },
    async payoutLink(id, returnUrl) {
      const a = await stripe<{ url: string }>("/account_links", {
        account: id,
        type: "account_onboarding",
        return_url: returnUrl,
        refresh_url: returnUrl,
      });
      return a.url;
    },
    async createHold({ key, cents, destination, returnUrl, tradeId }) {
      const result = await stripe<Session>(
        "/checkout/sessions",
        {
          mode: "payment",
          "payment_method_types[0]": "card",
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][product_data][name]":
            "BSTY trade authorization",
          "line_items[0][price_data][unit_amount]": String(cents),
          "line_items[0][quantity]": "1",
          "payment_intent_data[capture_method]": "manual",
          "payment_intent_data[transfer_data][destination]": destination,
          "payment_intent_data[metadata][trade_id]": tradeId,
          "payment_method_options[card][request_extended_authorization]":
            "if_available",
          success_url: returnUrl,
          cancel_url: returnUrl,
        },
        key,
      );
      if (
        !result.url ||
        result.livemode !== (mode === "live") ||
        result.amount_total !== cents
      )
        fail(
          502,
          "The payment provider returned a different checkout.",
          "PROVIDER_MISMATCH",
        );
      return { id: result.id, url: result.url };
    },
    async hold(id, cents) {
      return holdStatus(await session(id, cents));
    },
    async settleHold(id, cents, captureCents) {
      let current = await session(id, cents);
      if (current.status === "open" && !captureCents) {
        // Expiring an open session races with a customer completing checkout.
        // Always re-read the session before choosing the next action.
        await stripe(
          sessionPath(id) + "/expire",
          {},
          "bsty-expire-" + id,
        ).catch(() => undefined);
        current = await session(id, cents);
      }
      const intent = current.payment_intent;
      if (intent && holdStatus(current).status === "authorized" && captureCents)
        await stripe(
          "/payment_intents/" + encodeURIComponent(intent.id) + "/capture",
          { amount_to_capture: String(captureCents) },
          "bsty-capture-" + intent.id,
        );
      if (
        current.status === "complete" &&
        intent &&
        !captureCents &&
        intent.status === "requires_capture"
      )
        await stripe(
          "/payment_intents/" + encodeURIComponent(intent.id) + "/cancel",
          {},
          "bsty-release-" + intent.id,
        );
      return holdStatus(await session(id, cents));
    },
    async track(carrier, code) {
      return mapTracker(
        await easy<EasyTracker>("/trackers", {
          tracker: { carrier, tracking_code: code },
        }),
      );
    },
    async tracking(id) {
      return mapTracker(
        await easy<EasyTracker>("/trackers/" + encodeURIComponent(id)),
      );
    },
    async quote(from, to, parcel) {
      // A quote is free of side effects on the postage balance. The provider
      // mode is checked before its shipment ID can be used to buy a label.
      const s = await easy<EasyShipment>("/shipments", {
        shipment: {
          from_address: address(from),
          to_address: address(to),
          parcel,
        },
      });
      assertShippingMode(s.mode);
      const rates = s.rates
        .flatMap((r) => {
          const cents = Math.round(Number(r.rate) * 100);
          if (
            r.currency !== "USD" ||
            !Number.isSafeInteger(cents) ||
            cents < 1 ||
            cents > labelBudgetCents
          )
            return [];
          return [{ id: r.id, carrier: r.carrier, service: r.service, cents }];
        })
        .sort((a, b) => a.cents - b.cents);
      return { id: s.id, rates };
    },
    async label(quoteId, rate, allowPurchase) {
      const path = "/shipments/" + encodeURIComponent(quoteId);
      let s = await easy<EasyShipment>(path);
      assertShippingMode(s.mode);
      if (!s.postage_label?.label_url) {
        if (!allowPurchase) return null;
        const expected = s.rates.find((r) => r.id === rate.id);
        if (
          !expected ||
          expected.currency !== "USD" ||
          Math.round(Number(expected.rate) * 100) !== rate.cents
        )
          fail(
            409,
            "This postage rate changed. Contact support before retrying.",
            "RATE_CHANGED",
          );
        s = await easy<EasyShipment>(path + "/buy", { rate: { id: rate.id } });
        assertShippingMode(s.mode);
      }
      const url = s.postage_label?.label_url;
      if (
        !url?.startsWith("https://") ||
        !s.tracker ||
        s.selected_rate?.id !== rate.id
      )
        fail(
          502,
          "The carrier did not confirm this label. Refresh before retrying.",
          "LABEL_UNCONFIRMED",
        );
      return { url, tracking: mapTracker(s.tracker) };
    },
  };
}
