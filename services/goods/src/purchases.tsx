import { PracticeHistory } from "./practice";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CreditCard, PackageCheck } from "lucide-react";
import { api, money, requestId, time, type Listing } from "./api";
import {
  Confirm,
  Dialog,
  Empty,
  ErrorBox,
  Link,
  Loading,
  PageTitle,
  Photo,
  SignedOut,
  useApp,
  useResource,
} from "./ui";
import {
  AddressInputs,
  AddressLines,
  DeliveryMethodPicker,
  type Address,
} from "./shipping";

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
  fulfillment: "pickup" | "shipping";
  canRefund: boolean;
  shipment: {
    address: Address | null;
    carrier: string | null;
    code: string | null;
    status: string | null;
    reviewBy: string | null;
    issue: string | null;
    canTrack: boolean;
  } | null;
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

function orderLabel(order: Order) {
  if (!order.shipment) return stateLabels[order.state];
  if (order.state === "complete") return "Order complete";
  if (order.state !== "paid") return stateLabels[order.state];
  if (order.shipment.issue) return "Delivery issue reported";
  if (order.shipment.reviewBy)
    return order.role === "buyer"
      ? "Delivered · Review your item"
      : "Delivered · Awaiting buyer review";
  if (order.shipment.code) return "Paid · Tracking available";
  return "Paid · Awaiting shipment";
}

type OrderCommand =
  | { action: "pay" | "cancel" | "complete" | "refund" }
  | { action: "track"; carrier: string; code: string }
  | { action: "report"; reason: string };

export function OrdersLink({ fromProfile = false }: { fromProfile?: boolean }) {
  const { user } = useApp();
  const { data } = useResource<{ enabled: boolean }>(
    user ? "/purchases/options" : null,
  );
  const practice = useResource<{ items: unknown[] }>(
    user && !data?.enabled ? "/practice?kind=purchase" : null,
  );
  return data?.enabled || practice.data?.items.length ? (
    <Link
      className="button secondary"
      to={fromProfile ? "/orders?from=profile" : "/orders"}
    >
      Orders
    </Link>
  ) : null;
}

export function BuyAction({
  listing,
  shipping,
}: {
  listing: Listing;
  shipping: boolean;
}) {
  const { go, requireUser } = useApp();
  const key = useRef<{ details: string; id: string }>();
  const [choosing, setChoosing] = useState(false);
  const [fulfillment, setFulfillment] = useState<"pickup" | "shipping">(
    "pickup",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start(
    method: "pickup" | "shipping",
    address?: Record<string, FormDataEntryValue>,
  ) {
    if (!requireUser() || busy) return;
    setBusy(true);
    setError("");
    try {
      const details = JSON.stringify({ method, address });
      if (key.current?.details !== details)
        key.current = { details, id: requestId() };
      const result = await api<{ id: string }>("/purchases", "POST", {
        listingId: listing.id,
        version: listing.version,
        requestId: key.current.id,
        fulfillment: method,
        address,
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
      <button
        className="button full"
        disabled={busy}
        onClick={() => {
          if (!requireUser()) return;
          if (shipping) setChoosing(true);
          else void start("pickup");
        }}
      >
        <CreditCard size={18} /> Buy for {money(listing.priceCents)}
      </button>
      <small>
        {shipping ? "Shipping or local pickup" : "Local pickup"} · Test checkout
      </small>
      {error && !choosing && <ErrorBox error={error} />}
      {choosing && (
        <Dialog
          title="Review purchase"
          onClose={() => !busy && setChoosing(false)}
        >
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              fields.delete("method");
              const address =
                fulfillment === "shipping"
                  ? Object.fromEntries(fields)
                  : undefined;
              void start(fulfillment, address);
            }}
          >
            <div className="purchase-line-item">
              <Photo listing={listing} />
              <div>
                <strong>{listing.title}</strong>
                <small>
                  {listing.owner.name} · {listing.code}
                </small>
              </div>
              <b>{money(listing.priceCents)}</b>
            </div>
            <DeliveryMethodPicker
              method={fulfillment}
              onChange={setFulfillment}
            />
            {fulfillment === "shipping" ? (
              <>
                <p>
                  Use a fictional U.S. address for this test. The seller covers
                  postage.
                </p>
                <AddressInputs test />
              </>
            ) : (
              <p>
                Arrange a pickup time and place with the seller after payment.
              </p>
            )}
            <button className="button full" disabled={busy}>
              Review order
            </button>
            {error && <ErrorBox error={error} />}
          </form>
        </Dialog>
      )}
    </div>
  );
}

export function Orders() {
  const { user } = useApp();
  const { data: options, loading: checking } = useResource<{
    enabled: boolean;
    shipping: boolean;
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
      <>
        <PageTitle title="Orders" back="/profile" />
        <PracticeHistory kind="purchase" />
        <Link className="back-link" to="/explore">
          Browse listings
        </Link>
      </>
    );
  return (
    <>
      <PageTitle
        title="Orders"
        back={
          new URLSearchParams(location.search).get("from") === "profile"
            ? "/profile"
            : "/sell"
        }
      />
      <PracticeHistory kind="purchase" />
      <div className="orders-layout">
        <section className="orders-history" aria-label="Order history">
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorBox error={error} retry={reload} />
          ) : (
            <>
              <h2 id="order-list-title">Buying and selling</h2>
              {data?.orders.length ? (
                <ul className="order-list">
                  {data.orders.map((order) => (
                    <li key={order.id}>
                      <Link to={"/orders/" + order.id}>
                        <strong>{order.title}</strong>
                        <span>
                          {order.role === "buyer" ? "Buying" : "Selling"} ·{" "}
                          {orderLabel(order)} ·{" "}
                          {order.fulfillment === "shipping"
                            ? "Shipping"
                            : "Local pickup"}
                        </span>
                        <b className="order-amount">{money(order.cents)}</b>
                        <ArrowRight size={18} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  Your purchases and sales will appear here.
                </p>
              )}
            </>
          )}
        </section>
        {data && (
          <section
            className="panel order-setup"
            aria-labelledby="seller-checkout"
          >
            <h2 id="seller-checkout">Seller checkout</h2>
            <p>
              {data?.sellerReady
                ? "Test payments are ready for your sale-only listings."
                : options.shipping
                  ? "Connect a Stripe test account to sell with shipping or local pickup."
                  : "Connect a Stripe test account to sell with local pickup."}
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
        )}
      </div>
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
  const [reporting, setReporting] = useState(false);
  const order = data?.order;
  const pending =
    order?.state === "pending" ||
    order?.state === "paid" ||
    order?.state === "refunding";
  useEffect(() => {
    if (!pending || busy || confirm || reporting) return;
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
  }, [path, pending, busy, confirm, reporting, setData]);

  async function act(command: OrderCommand) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ order: Order; url?: string }>(
        path,
        "POST",
        command,
      );
      setData(result);
      setConfirm(null);
      setReporting(false);
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
  const shipment = order.shipment;
  const canConfirmReceipt =
    order.state === "paid" &&
    buyer &&
    (!shipment || (shipment.reviewBy && !shipment.issue));
  const canReport = shipment?.reviewBy && !shipment.issue && canConfirmReceipt;
  function submitTracking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act({
      action: "track",
      carrier: String(data.get("carrier")),
      code: String(data.get("code")),
    });
  }
  const confirmation = {
    cancel: [
      "Cancel this checkout?",
      "The reservation ends when the payment provider confirms checkout is closed.",
      "Cancel checkout",
    ],
    complete: shipment
      ? [
          "Confirm receipt?",
          "Check that the item matches the listing before completing your order.",
          "Confirm receipt",
        ]
      : [
          "Confirm pickup?",
          "Confirm after you receive the item in person.",
          "Confirm pickup",
        ],
    refund: [
      "Refund this order?",
      shipment?.issue
        ? "Send the full amount back to the buyer’s original payment method. This does not arrange return shipping."
        : "Send the full amount back to the buyer’s original payment method.",
      "Refund buyer",
    ],
  } as const;
  return (
    <>
      <PageTitle title={order.title} back="/orders" />
      <section className="panel order-panel" aria-labelledby="order-state">
        <span className="eyebrow">
          Test order · {buyer ? "Buying" : "Selling"} ·{" "}
          {shipment ? "Shipping" : "Local pickup"}
        </span>
        <h2 id="order-state" aria-live="polite">
          {orderLabel(order)}
        </h2>
        <p>
          {order.state === "pending" && !buyer
            ? "The buyer is reviewing checkout. Wait for payment confirmation before fulfilling the order."
            : shipment && order.state === "pending"
              ? "Review your shipping address and total before continuing to test payment."
              : shipment && order.state === "paid"
                ? shipment.issue
                  ? "The order stays open while the delivery issue is unresolved."
                  : shipment.reviewBy
                    ? buyer
                      ? "Check your item and confirm receipt or report a problem by " +
                        time(shipment.reviewBy) +
                        "."
                      : "The buyer can review the item until " +
                        time(shipment.reviewBy) +
                        "."
                    : shipment.code
                      ? "Tracking is saved. Check this order for carrier updates."
                      : buyer
                        ? "Payment confirmed. Check this order for carrier updates."
                        : "Use your own shipping label and add the carrier and tracking number here."
                : shipment && order.state === "complete"
                  ? "The delivery review is complete."
                  : details[order.state]}
        </p>
        <div className="order-total">
          <span>Total</span>
          <strong>{money(order.cents)}</strong>
        </div>
        {shipment?.address && (
          <section aria-label="Shipping address">
            <h3>Ship to</h3>
            <AddressLines address={shipment.address} />
          </section>
        )}
        {shipment?.code && (
          <p>
            <strong>
              {shipment.carrier} {shipment.code}
            </strong>{" "}
            · {shipment.status?.replaceAll("_", " ")}
          </p>
        )}
        {shipment?.issue && (
          <p>
            <strong>Reported issue</strong> · {shipment.issue}
          </p>
        )}
        {shipment?.canTrack && (
          <form className="shipping-form" onSubmit={submitTracking}>
            <label>
              <span id="purchase-carrier-label">Carrier</span>
              <select
                name="carrier"
                aria-labelledby="purchase-carrier-label"
                required
              >
                <option value="">Choose carrier</option>
                <option>USPS</option>
                <option>UPS</option>
                <option>FedEx</option>
                <option value="DHLExpress">DHL Express</option>
              </select>
            </label>
            <label>
              Tracking number
              <input name="code" minLength={7} maxLength={40} required />
            </label>
            <button className="button" disabled={busy}>
              Add tracking
            </button>
          </form>
        )}
        <div className="actions">
          {buyer && order.state === "pending" && (
            <>
              <button
                className="button"
                onClick={() => act({ action: "pay" })}
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
          {canConfirmReceipt && (
            <button
              className="button"
              onClick={() => setConfirm("complete")}
              disabled={busy}
            >
              <PackageCheck size={18} /> {confirmation.complete[2]}
            </button>
          )}
          {canReport && (
            <button
              className="button secondary"
              onClick={() => {
                setActionError("");
                setReporting(true);
              }}
              disabled={busy}
            >
              Report a delivery issue
            </button>
          )}
          {order.canRefund && (
            <button
              className="button secondary"
              onClick={() => setConfirm("refund")}
              disabled={busy}
            >
              Refund buyer
            </button>
          )}
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
        {actionError && !reporting && <ErrorBox error={actionError} />}
        <small className="muted">Order {order.id}</small>
      </section>
      {confirm && (
        <Confirm
          title={confirmation[confirm][0]}
          body={confirmation[confirm][1]}
          label={confirmation[confirm][2]}
          onConfirm={() => act({ action: confirm })}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
          busy={busy}
        />
      )}
      {reporting && (
        <Dialog
          title="Report a delivery issue"
          onClose={() => !busy && setReporting(false)}
        >
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(
                new FormData(event.currentTarget).get("reason"),
              );
              void act({ action: "report", reason });
            }}
          >
            <p>The seller will see your report and the order will stay open.</p>
            <label>
              What happened?
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
                rows={4}
              />
            </label>
            <button className="button full" disabled={busy}>
              Submit report
            </button>
            {actionError && <ErrorBox error={actionError} />}
          </form>
        </Dialog>
      )}
    </>
  );
}
