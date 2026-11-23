import { useState, type FormEvent } from "react";
import { Package, ShieldCheck } from "lucide-react";
import { api, money, time } from "./api";
import { ErrorBox } from "./ui";

export type TradeOptions = {
  shipping: boolean;
  maxShippedValue: number;
  mode: "test" | "live" | null;
};

export type Address = {
  name: string;
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
};
type Parcel = {
  userId: string;
  payoutReady: boolean;
  securityCents: number;
  cashCents: number;
  holdStatus: string;
  holdUntil: string | null;
  capturedCents: number;
  carrier: string | null;
  trackingCode: string | null;
  trackingStatus: string | null;
};
export type ShippingView = {
  tradeState: string;
  mode: "test" | "live";
  labelBudgetCents: number;
  shipBy: string;
  active: boolean;
  readyToShip: boolean;
  canContinueLabel: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  canEditAddress: boolean;
  canAuthorize: boolean;
  resolving: "completed" | "canceled" | null;
  settlementError: boolean;
  own: Parcel & {
    address: Address | null;
    labelUrl: string | null;
    selectedRate: string | null;
    quoteRates: {
      id: string;
      carrier: string;
      service: string;
      cents: number;
    }[];
  };
  other: Parcel & { addressSaved: boolean };
  destination: Address | null;
};

const holdLabels: Record<string, string> = {
  none: "Awaiting authorization",
  checkout: "Checkout started",
  authorized: "Hold authorized",
  too_short: "Hold released · card window too short",
  expired: "Checkout expired",
  released: "Hold released",
};

export function ShippingTerms({
  yours,
  theirs,
  cash,
}: {
  yours: number;
  theirs: number;
  cash: number;
}) {
  const youPay = yours < theirs ? cash : 0;
  const theyPay = theirs < yours ? cash : 0;
  return (
    <div className="shipping-terms">
      <h3>Protected shipping</h3>
      <dl>
        <div>
          <dt>Your card hold</dt>
          <dd>{money(theirs + youPay)}</dd>
        </div>
        <div>
          <dt>Other trader’s card hold</dt>
          <dd>{money(yours + theyPay)}</dd>
        </div>
        {cash > 0 && (
          <div>
            <dt>
              {youPay ? "You pay after delivery" : "You receive after delivery"}
            </dt>
            <dd>{money(cash)}</dd>
          </div>
        )}
      </dl>
      <p>
        Each hold covers the value of the item that person receives, plus any
        cash difference they agreed to pay. After both people confirm delivery,
        BSTY collects only the agreed cash difference and releases the rest. For
        a disputed trade, support can review evidence and use up to the item
        value from the hold to compensate the other trader.
      </p>
    </div>
  );
}

export function AddressInputs({
  address,
  test = false,
}: {
  address?: Address | null;
  test?: boolean;
}) {
  return (
    <>
      {(
        [
          ["Name for delivery", "name", "name", 80],
          ["Street address", "street", "address-line1", 100],
          ["Apartment or unit", "unit", "address-line2", 40],
          ["City", "city", "address-level2", 80],
          ["State code", "state", "address-level1", 2],
          ["ZIP code", "zip", "postal-code", 10],
        ] as const
      ).map(([label, key, autoComplete, max]) => (
        <label key={key}>
          {label}
          <input
            name={key}
            autoComplete={test ? "off" : autoComplete}
            required={key !== "unit"}
            maxLength={max}
            defaultValue={address?.[key]}
          />
        </label>
      ))}
    </>
  );
}

export function AddressLines({ address }: { address: Address }) {
  return (
    <address>
      {address.name}
      <br />
      {address.street}
      {address.unit && (
        <>
          <br />
          {address.unit}
        </>
      )}
      <br />
      {address.city}, {address.state} {address.zip}
    </address>
  );
}
function ParcelStatus({ parcel, title }: { parcel: Parcel; title: string }) {
  const totalCents = parcel.securityCents + parcel.cashCents;
  return (
    <article className="shipping-parcel">
      <h4>{title}</h4>
      <p>
        {parcel.capturedCents > 0
          ? money(parcel.capturedCents) +
            " collected · " +
            money(totalCents - parcel.capturedCents) +
            " released"
          : (holdLabels[parcel.holdStatus] ?? parcel.holdStatus) +
            " · " +
            money(totalCents)}
      </p>
      {parcel.holdStatus === "authorized" && parcel.holdUntil && (
        <small>Hold expires {time(parcel.holdUntil)}</small>
      )}
      {parcel.trackingCode ? (
        <p>
          <strong>
            {parcel.carrier} {parcel.trackingCode}
          </strong>
          <br />
          {(parcel.trackingStatus ?? "unknown").replaceAll("_", " ")}
        </p>
      ) : (
        <p>Awaiting tracking</p>
      )}
    </article>
  );
}

export function ShippingPanel({
  id,
  details,
  onRefresh,
}: {
  id: string;
  details: ShippingView;
  onRefresh: (data: ShippingView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [rate, setRate] = useState("");
  const path = "/trades/" + id + "/shipping";
  const { own, other, destination } = details;
  const run = async (command?: object) => {
    setBusy(true);
    setError("");
    try {
      if (command) {
        const result = await api<{ url: string | null }>(path, "POST", command);
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
      }
      const next = await api<ShippingView>(path + "/refresh", "POST");
      onRefresh(next);
      setEdit(false);
    } catch (e) {
      setError((e as Error).message);
      // A failed carrier response can still have locked the rate for retry.
      try {
        onRefresh(await api<ShippingView>(path));
      } catch {
        /* keep the last visible state */
      }
    } finally {
      setBusy(false);
    }
  };
  const saveAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run({
      action: "address",
      address: Object.fromEntries(new FormData(event.currentTarget)),
    });
  };
  const quote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const parcel = Object.fromEntries(
      [...fields].map(([key, value]) => [key, Number(value)]),
    );
    void run({ action: "quote", parcel });
  };
  const track = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run({
      action: "track",
      ...Object.fromEntries(new FormData(event.currentTarget)),
    });
  };
  return (
    <section className="shipping-panel" aria-labelledby="shipping-title">
      <div className="shipping-header">
        <h3 id="shipping-title">
          <Package size={21} /> Shipping and payment
        </h3>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void run()}
        >
          Refresh shipping status
        </button>
      </div>
      {details.mode === "test" && (
        <p className="shipping-note">
          Test trade. Payments, labels and delivery are simulated in the test
          environment.
        </p>
      )}
      {details.settlementError ? (
        <p role="status">The payment needs support review.</p>
      ) : details.resolving &&
        details.active === false &&
        ["accepted", "disputed"].includes(details.tradeState) ? (
        <p role="status">The payment provider is settling the holds.</p>
      ) : null}
      <div className="shipping-parcels">
        <ParcelStatus parcel={own} title="Your outbound parcel" />
        <ParcelStatus parcel={other} title="Your incoming parcel" />
      </div>
      {details.active && (
        <>
          <p>
            Hand both parcels to the carrier by{" "}
            <strong>{time(details.shipBy)}</strong>. Wait for both card holds
            before sending anything.
          </p>
          <div className="shipping-checklist">
            <section>
              <h4>Receiving address</h4>
              <p>
                {other.addressSaved
                  ? "The other trader saved their address."
                  : "Waiting for the other trader’s address."}
              </p>
              {own.address && !edit && (
                <>
                  <AddressLines address={own.address} />
                  {details.canEditAddress && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setEdit(true)}
                    >
                      Edit address
                    </button>
                  )}
                </>
              )}
              {details.canEditAddress && (!own.address || edit) && (
                <form className="shipping-form" onSubmit={saveAddress}>
                  <AddressInputs address={own.address} />
                  <button className="button secondary" disabled={busy}>
                    Save receiving address
                  </button>
                </form>
              )}
            </section>
            <section>
              <h4>
                <ShieldCheck size={18} /> Card hold
              </h4>
              {!own.payoutReady && (
                <p>
                  Set up payouts to receive an agreed cash difference or
                  compensation after a dispute review.
                </p>
              )}
              <p>
                {own.payoutReady
                  ? "Your payouts are ready."
                  : "Your payout setup is pending."}{" "}
                {other.payoutReady
                  ? "The other trader’s payouts are ready."
                  : "Waiting for the other trader’s payout setup."}
              </p>
              {!own.payoutReady && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void run({ action: "payout" })}
                >
                  Set up payouts
                </button>
              )}
              {own.holdStatus === "too_short" && (
                <p>Use a card eligible for a hold of at least 12 days.</p>
              )}
              {details.canAuthorize && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void run({ action: "authorize" })}
                >
                  {own.holdStatus === "checkout"
                    ? "Resume card authorization"
                    : "Authorize " +
                      money(own.securityCents + own.cashCents) +
                      " hold"}
                </button>
              )}
            </section>
          </div>
        </>
      )}
      {destination && (
        <section className="shipping-destination">
          <h4>Send your parcel to</h4>
          <AddressLines address={destination} />
          <button className="text-button" onClick={() => window.print()}>
            Print destination address
          </button>
        </section>
      )}
      {own.labelUrl && (
        <a
          className="button secondary"
          href={own.labelUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open shipping label
        </a>
      )}
      {(details.readyToShip || details.canContinueLabel) &&
        !own.trackingCode && (
          <section className="shipping-postage">
            <h4>Postage and tracking</h4>
            {!own.selectedRate && (
              <form className="shipping-form" onSubmit={track}>
                <label>
                  Carrier
                  <select name="carrier">
                    <option>USPS</option>
                    <option>UPS</option>
                    <option>FedEx</option>
                    <option value="DHLExpress">DHL Express</option>
                  </select>
                </label>
                <label>
                  Tracking number
                  <input name="code" required minLength={7} maxLength={40} />
                </label>
                <button className="button secondary" disabled={busy}>
                  Add tracking from your own label
                </button>
              </form>
            )}
            {details.labelBudgetCents > 0 && (
              <details
                open={Boolean(own.selectedRate || own.quoteRates.length)}
              >
                <summary>Get a shipping label</summary>
                <p>
                  {details.mode === "test"
                    ? "Choose a simulated prepaid label."
                    : "BSTY covers the postage for the rates shown here."}
                </p>
                {!own.selectedRate && (
                  <form className="shipping-form" onSubmit={quote}>
                    {(
                      [
                        ["Weight (oz)", "weight", 1120],
                        ["Length (in)", "length", 48],
                        ["Width (in)", "width", 48],
                        ["Height (in)", "height", 48],
                      ] as const
                    ).map(([label, name, max]) => (
                      <label key={name}>
                        {label}
                        <input
                          type="number"
                          name={name}
                          min={1}
                          max={max}
                          step={0.1}
                          required
                        />
                      </label>
                    ))}
                    <button className="button secondary" disabled={busy}>
                      Get postage rates
                    </button>
                  </form>
                )}
                {!!own.quoteRates.length && !own.selectedRate && (
                  <label>
                    Postage rate
                    <select
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    >
                      <option value="">Choose a rate</option>
                      {own.quoteRates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.carrier} {r.service} · {money(r.cents)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(own.selectedRate || rate) && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void run({
                        action: "label",
                        rateId: own.selectedRate || rate,
                      })
                    }
                  >
                    {own.selectedRate
                      ? "Recover shipping label"
                      : "Create shipping label"}
                  </button>
                )}
              </details>
            )}
          </section>
        )}
      {error && <ErrorBox error={error} />}
    </section>
  );
}
