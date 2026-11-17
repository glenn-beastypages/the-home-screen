import { fail, hash } from "./common.js";

export type Checkout = {
  id: string;
  url: string | null;
  state: "open" | "expired" | "paid" | "processing";
  orderId: string;
  cents: number;
  payment: string | null;
};
export type CheckoutRequest = {
  orderId: string;
  title: string;
  cents: number;
  expiresAt: number;
  returnUrl: string;
};
export type PurchaseProvider = {
  account(user: string): Promise<string>;
  ready(account: string): Promise<boolean>;
  onboarding(account: string, returnUrl: string): Promise<string>;
  checkout(account: string, order: CheckoutRequest): Promise<Checkout>;
  read(account: string, session: string): Promise<Checkout>;
  expire(account: string, session: string): Promise<Checkout>;
  refund(account: string, payment: string, orderId: string): Promise<string>;
  refundStatus(
    account: string,
    refund: string,
  ): Promise<"pending" | "failed" | "succeeded">;
};

export function purchaseProvider(
  config: NodeJS.ProcessEnv,
  origin: string,
  fixture?: PurchaseProvider,
): PurchaseProvider | null {
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(origin).hostname,
  );
  if (!loopback || config.NODE_ENV === "production") return null;
  if (fixture && config.NODE_ENV === "test") return fixture;
  if (config.GOODS_CHECKOUT !== "test") return null;
  const key = config.GOODS_CHECKOUT_STRIPE_KEY || "";
  if (!key.startsWith("sk_test_"))
    throw new Error("Checkout requires a Stripe test secret.");

  async function stripe<T>(
    path: string,
    fields?: Record<string, string>,
    account?: string,
    request?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch("https://api.stripe.com/v1" + path, {
        method: fields ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + key,
          ...(account ? { "Stripe-Account": account } : {}),
          ...(request ? { "Idempotency-Key": request } : {}),
        },
        body: fields ? new URLSearchParams(fields) : undefined,
        signal: AbortSignal.timeout(7500),
      });
    } catch {
      fail(
        503,
        "Stripe test mode is temporarily unavailable. Try again.",
        "PAYMENT_PROVIDER",
      );
    }
    if (!response.ok)
      fail(
        502,
        "Stripe could not complete this test request. Try again.",
        "PAYMENT_PROVIDER",
      );
    return (await response.json()) as T;
  }

  function trustedUrl(url: string, hostname: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== hostname)
      fail(502, "Stripe gave an invalid payment link.");
    return url;
  }

  type StripeSession = {
    id: string;
    url: string | null;
    status: string;
    payment_status: string;
    currency: string;
    amount_total: number;
    client_reference_id: string;
    payment_intent: string | null;
    livemode: boolean;
    mode: string;
  };
  function session(value: StripeSession): Checkout {
    if (
      value.livemode !== false ||
      value.currency !== "usd" ||
      value.mode !== "payment"
    )
      fail(502, "Stripe did not return a valid test purchase.");
    return {
      id: value.id,
      url: value.url ? trustedUrl(value.url, "checkout.stripe.com") : null,
      state:
        value.status === "complete" && value.payment_status === "paid"
          ? "paid"
          : value.status === "expired"
            ? "expired"
            : value.status === "open"
              ? "open"
              : "processing",
      orderId: value.client_reference_id,
      cents: value.amount_total,
      payment: value.payment_intent,
    };
  }
  const checkoutPath = (id: string) =>
    "/checkout/sessions/" + encodeURIComponent(id);
  return {
    async account(user) {
      const a = await stripe<{ id: string }>(
        "/accounts",
        {
          country: "US",
          type: "express",
          "capabilities[card_payments][requested]": "true",
          "capabilities[transfers][requested]": "true",
        },
        undefined,
        "goods-purchase-seller-" + hash(user),
      );
      return a.id;
    },
    async ready(account) {
      const a = await stripe<{
        charges_enabled: boolean;
        payouts_enabled: boolean;
      }>("/accounts/" + encodeURIComponent(account));
      return a.charges_enabled && a.payouts_enabled;
    },
    async onboarding(account, returnUrl) {
      const link = await stripe<{ url: string }>("/account_links", {
        account,
        type: "account_onboarding",
        refresh_url: returnUrl,
        return_url: returnUrl,
      });
      return trustedUrl(link.url, "connect.stripe.com");
    },
    async checkout(account, order) {
      return session(
        await stripe<StripeSession>(
          "/checkout/sessions",
          {
            mode: "payment",
            client_reference_id: order.orderId,
            expires_at: String(order.expiresAt),
            success_url: order.returnUrl,
            cancel_url: order.returnUrl,
            "payment_method_types[0]": "card",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": String(order.cents),
            "line_items[0][price_data][product_data][name]": order.title,
          },
          account,
          "goods-purchase-" + order.orderId,
        ),
      );
    },
    async read(account, id) {
      return session(
        await stripe<StripeSession>(checkoutPath(id), undefined, account),
      );
    },
    async expire(account, id) {
      try {
        return session(
          await stripe<StripeSession>(
            checkoutPath(id) + "/expire",
            {},
            account,
          ),
        );
      } catch {
        // An expiration request can race a successful card payment.
        return this.read(account, id);
      }
    },
    async refund(account, payment, orderId) {
      const r = await stripe<{ id: string }>(
        "/refunds",
        { payment_intent: payment },
        account,
        "goods-refund-" + orderId,
      );
      return r.id;
    },
    async refundStatus(account, refund) {
      const r = await stripe<{ status: string }>(
        "/refunds/" + encodeURIComponent(refund),
        undefined,
        account,
      );
      if (r.status === "succeeded") return "succeeded";
      if (["failed", "canceled"].includes(r.status)) return "failed";
      return "pending";
    },
  };
}
