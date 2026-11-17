import { useEffect, useRef, useState } from "react";
import { ArrowRight, CreditCard, PackageCheck } from "lucide-react";
import { api, money, requestId, type Listing } from "./api";
import {
  Confirm,
  Empty,
  ErrorBox,
  Link,
  Loading,
  PageTitle,
  SignedOut,
  useApp,
  useResource,
} from "./ui";

type OrderState =
  | "pending"
  | "canceled"
  | "paid"
  | "complete"
  | "refunding"
  | "refunded"
  | "refund_failed";
type Order = {
  id: string;
  listingId: string;
  title: string;
  cents: number;
  role: "buyer" | "seller";
  conversationId: string;
  state: OrderState;
};
const stateLabels: Record<OrderState, string> = {
  pending: "Awaiting payment",
  canceled: "Checkout canceled",
  paid: "Paid · Pickup pending",
  complete: "Pickup confirmed",
  refunding: "Refund in progress",
  refunded: "Refunded",
  refund_failed: "Refund needs attention",
};

export function OrdersLink() {
  const { user } = useApp();
  const { data } = useResource<{ enabled: boolean }>(
    user ? "/purchases/options" : null,
  );
  return data?.enabled ? (
    <Link className="button secondary" to="/orders">
      Orders
    </Link>
  ) : null;
}

export function BuyAction({ listing }: { listing: Listing }) {
  const { go, requireUser } = useApp();
  const key = useRef(requestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (!requireUser() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/purchases", "POST", {
        listingId: listing.id,
        version: listing.version,
        requestId: key.current,
      });
      go("/orders/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="purchase-action">
      <button className="button full" disabled={busy} onClick={start}>
        <CreditCard size={18} /> Buy for {money(listing.priceCents)}
      </button>
      <small>Local pickup · Test checkout</small>
      {error && <ErrorBox error={error} />}
    </div>
  );
}

export function Orders() {
  const { user } = useApp();
  const { data: options, loading: checking } = useResource<{
    enabled: boolean;
  }>(user ? "/purchases/options" : null);
  const { data, error, loading, reload } = useResource<{
    orders: Order[];
    sellerReady: boolean;
  }>(options?.enabled ? "/purchases" : null);
  const [setupError, setSetupError] = useState("");
  const [busy, setBusy] = useState(false);
  async function setup(refresh: boolean) {
    setBusy(true);
    setSetupError("");
    try {
      const result = await api<{ ready: boolean; url?: string }>(
        "/purchases/setup",
        "POST",
        { refresh },
      );
      if (result.url) window.location.assign(result.url);
      else reload();
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (options?.enabled && new URLSearchParams(location.search).has("setup"))
      void setup(true);
  }, [options?.enabled]);
  if (!user) return <SignedOut what="see your orders" />;
  if (checking) return <Loading />;
  if (!options?.enabled)
    return (
      <Empty
        title="Checkout is unavailable"
        body="Browse listings and message sellers to arrange a purchase."
        action={{ label: "Explore", to: "/explore" }}
      />
    );
  return (
    <>
      <PageTitle title="Orders" back="/sell" />
      <section className="panel order-panel" aria-labelledby="seller-checkout">
        <h2 id="seller-checkout">Seller checkout</h2>
        <p>
          {data?.sellerReady
            ? "Test payments are ready for your sale-only listings."
            : "Connect a Stripe test account to try selling for local pickup."}
        </p>
        {!data?.sellerReady && (
          <button
            className="button"
            disabled={busy}
            onClick={() => setup(false)}
          >
            Set up test checkout
          </button>
        )}
        {setupError && <ErrorBox error={setupError} />}
      </section>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : (
        <>
          <h2>Buying and selling</h2>
          {data?.orders.length ? (
            <ul className="order-list">
              {data.orders.map((order) => (
                <li key={order.id}>
                  <Link to={"/orders/" + order.id}>
                    <strong>{order.title}</strong>
                    <span>
                      {order.role === "buyer" ? "Buying" : "Selling"} ·{" "}
                      {stateLabels[order.state]} · {money(order.cents)}
                    </span>
                    <ArrowRight size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Your purchases and sales will appear here.</p>
          )}
        </>
      )}
    </>
  );
}

const details: Record<OrderState, string> = {
  pending:
    "Review the total and continue to the test payment page. Arrange local pickup with the seller.",
  canceled:
    "No payment was taken. You can return to the listing to check availability.",
  paid: "Payment was confirmed. Use the conversation to agree on a local pickup time and place.",
  complete: "The buyer confirmed they picked up the item.",
  refunding: "The payment provider is processing the refund.",
  refunded:
    "The payment provider confirmed the refund to the original payment method.",
  refund_failed:
    "The payment provider could not finish the refund. Contact support with this order number.",
};

export function OrderPage({ id }: { id: string }) {
  const { user } = useApp();
  const path = "/purchases/" + id;
  const { data, setData, loading, error, reload } = useResource<{
    order: Order;
  }>(user ? path : null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    "cancel" | "complete" | "refund" | null
  >(null);
  const order = data?.order;
  const pending =
    order?.state === "pending" ||
    order?.state === "paid" ||
    order?.state === "refunding";
  useEffect(() => {
    if (!pending || busy || confirm) return;
    let open = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const result = await api<{ order: Order }>(path);
        if (open) setData(result);
      } catch {
        // Keep the last confirmed order state visible.
      } finally {
        inFlight = false;
      }
    }, 5000);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, [path, pending, busy, confirm, setData]);

  async function act(action: "pay" | "cancel" | "complete" | "refund") {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ order: Order; url?: string }>(path, "POST", {
        action,
      });
      setData(result);
      setConfirm(null);
      if (result.url) window.location.assign(result.url);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <SignedOut what="view this order" />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!order) return null;
  const buyer = order.role === "buyer";
  const confirmation = {
    cancel: [
      "Cancel this checkout?",
      "The reservation ends when the payment provider confirms checkout is closed.",
      "Cancel checkout",
    ],
    complete: [
      "Confirm pickup?",
      "Confirm after you receive the item in person.",
      "Confirm pickup",
    ],
    refund: [
      "Refund this order?",
      "Send the full amount back to the buyer’s original payment method.",
      "Refund buyer",
    ],
  } as const;
  return (
    <>
      <PageTitle title={order.title} back="/orders" />
      <section className="panel order-panel" aria-labelledby="order-state">
        <span className="eyebrow">
          Test order · {buyer ? "Buying" : "Selling"} · Local pickup
        </span>
        <h2 id="order-state" aria-live="polite">
          {stateLabels[order.state]}
        </h2>
        <p>
          {order.state === "pending" && !buyer
            ? "The buyer is reviewing checkout. Wait for payment confirmation before handing over the item."
            : details[order.state]}
        </p>
        <div className="order-total">
          <span>Total</span>
          <strong>{money(order.cents)}</strong>
        </div>
        <div className="actions">
          {buyer && order.state === "pending" && (
            <>
              <button
                className="button"
                onClick={() => act("pay")}
                disabled={busy}
              >
                Continue to test payment
              </button>
              <button
                className="button secondary"
                onClick={() => setConfirm("cancel")}
                disabled={busy}
              >
                Cancel checkout
              </button>
            </>
          )}
          {order.state === "paid" &&
            (buyer ? (
              <button
                className="button"
                onClick={() => setConfirm("complete")}
                disabled={busy}
              >
                <PackageCheck size={18} /> Confirm pickup
              </button>
            ) : (
              <button
                className="button secondary"
                onClick={() => setConfirm("refund")}
                disabled={busy}
              >
                Refund buyer
              </button>
            ))}
          {order.state !== "canceled" && (
            <Link
              className="button secondary"
              to={"/inbox/" + order.conversationId}
            >
              Open conversation
            </Link>
          )}
          <Link className="text-button" to={"/items/" + order.listingId}>
            View listing
          </Link>
        </div>
        {actionError && <ErrorBox error={actionError} />}
        <small className="muted">Order {order.id}</small>
      </section>
      {confirm && (
        <Confirm
          title={confirmation[confirm][0]}
          body={confirmation[confirm][1]}
          label={confirmation[confirm][2]}
          onConfirm={() => act(confirm)}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
          busy={busy}
        />
      )}
    </>
  );
}
