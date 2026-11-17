import { useState, type FormEvent } from "react";
import { ArrowUpRight, CalendarDays, Check, Package } from "lucide-react";
import { api, time, type Trade, type TradeParcel } from "./api";
import { ErrorBox, Spinner, useApp } from "./ui";

function ParcelTracking({
  direction,
  tracking,
}: {
  direction: "Outgoing parcel" | "Incoming parcel";
  tracking: NonNullable<TradeParcel["tracking"]>;
}) {
  const carrier = tracking.carrier.trim().toLowerCase();
  const number = encodeURIComponent(tracking.code);
  let href: string | undefined;
  if (carrier === "usps" || carrier === "united states postal service")
    href = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (carrier === "ups" || carrier === "united parcel service")
    href = `https://www.ups.com/track?tracknum=${number}`;
  if (carrier === "fedex" || carrier === "federal express")
    href = `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  return (
    <div className="swap-parcel-tracking">
      <span className="swap-subtle">{direction}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Track ${direction.toLowerCase()} with ${tracking.carrier}`}
        >
          {tracking.carrier} {tracking.code}{" "}
          <ArrowUpRight size={14} aria-hidden />
        </a>
      ) : (
        <strong>
          {tracking.carrier} {tracking.code}
        </strong>
      )}
    </div>
  );
}

export function ExchangePlanPanel({
  trade,
  onUpdate,
  protectedShipBy,
}: {
  trade: Trade;
  onUpdate: (trade: Trade) => void;
  protectedShipBy?: string;
}) {
  const { user } = useApp();
  const plan = trade.exchangePlan;
  const meetup = trade.fulfillment === "meetup";
  const arrangedShipping = trade.fulfillment === "arranged_shipping";
  const protectedShipping = trade.fulfillment === "shipping";
  const agreed = plan?.confirmedBy.length === 2;
  const canEdit =
    trade.state === "accepted" &&
    !trade.cancelRequestedBy.length &&
    !trade.confirmedBy.length &&
    !trade.shipments?.yours.tracking &&
    !trade.shipments?.theirs.tracking;
  const [editPlan, setEditPlan] = useState(false);
  const [editAddress, setEditAddress] = useState(false);
  const [editTracking, setEditTracking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { yours, theirs } = trade.shipments ?? { yours: null, theirs: null };
  const canTrack =
    canEdit ||
    (!trade.confirmedBy.length &&
      !trade.cancelRequestedBy.length &&
      trade.state === "accepted");
  async function save(
    path: "plan" | "shipment",
    body: object,
    done?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ trade: Trade }>(
        `/trades/${trade.id}/${path}`,
        "POST",
        body,
      );
      onUpdate(data.trade);
      done?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const formValues = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget));
  };
  const waiting = plan?.confirmedBy.includes(user!.id);
  const today = new Date();
  const localDate = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);

  return (
    <section className="swap-exchange" aria-label="Exchange plan">
      <div className="swap-section-heading">
        {meetup ? (
          <CalendarDays size={19} aria-hidden />
        ) : (
          <Package size={19} aria-hidden />
        )}
        <h2>{meetup ? "Meetup plan" : "Shipping plan"}</h2>
        {agreed && (
          <span className="swap-agreed">
            <Check size={14} /> Confirmed
          </span>
        )}
      </div>
      {canEdit && (editPlan || !plan) ? (
        <form
          className="swap-form"
          onSubmit={(event) => {
            const values = formValues(event);
            void save(
              "plan",
              {
                action: "propose",
                expectedVersion: plan?.version ?? 0,
                ...values,
              },
              () => setEditPlan(false),
            );
          }}
        >
          {meetup ? (
            <>
              <label>
                Public meeting place
                <input
                  name="place"
                  autoComplete="off"
                  placeholder="e.g. Library main entrance"
                  minLength={3}
                  maxLength={160}
                  defaultValue={plan?.place}
                  required
                />
              </label>
              <label>
                Date and time
                <input
                  name="time"
                  autoComplete="off"
                  placeholder="e.g. Saturday, 2 p.m. PT"
                  minLength={3}
                  maxLength={120}
                  defaultValue={plan?.time}
                  required
                />
              </label>
            </>
          ) : protectedShipping ? (
            protectedShipBy && (
              <p className="swap-subtle">Ship by {time(protectedShipBy)}</p>
            )
          ) : (
            <label>
              Ship by
              <input
                name="shipBy"
                type="date"
                min={localDate(today)}
                defaultValue={plan?.shipBy}
                required
              />
            </label>
          )}
          <div className="swap-inline-actions">
            <button
              className="button"
              disabled={busy || (protectedShipping && !protectedShipBy)}
            >
              {busy && <Spinner />}{" "}
              {protectedShipping ? "Confirm my shipping plan" : "Propose plan"}
            </button>
            {plan && (
              <button
                type="button"
                className="text-button"
                onClick={() => setEditPlan(false)}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      ) : plan ? (
        <>
          <div className="swap-plan-values">
            <strong>
              {meetup
                ? plan.place
                : protectedShipBy
                  ? `Ship by ${time(protectedShipBy)}`
                  : `Ship by ${new Date(plan.shipBy + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </strong>
            {meetup && <span>{plan.time}</span>}
          </div>
          {canEdit && (
            <div className="swap-inline-actions">
              {!agreed &&
                (waiting ? (
                  <span className="swap-subtle">
                    Waiting for their confirmation
                  </span>
                ) : (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      save("plan", {
                        action: "confirm",
                        expectedVersion: plan.version,
                      })
                    }
                  >
                    {busy && <Spinner />} Confirm plan
                  </button>
                ))}
              {!protectedShipping && (
                <button
                  className="text-button"
                  onClick={() => setEditPlan(true)}
                >
                  Suggest a change
                </button>
              )}
            </div>
          )}
        </>
      ) : null}
      {arrangedShipping &&
        agreed &&
        trade.state === "accepted" &&
        yours &&
        theirs &&
        !trade.cancelRequestedBy.length && (
          <div className="swap-shipping-details">
            <p className="swap-subtle">
              Use tracked postage and keep your receipt. BSTY doesn’t cover lost
              or damaged parcels.
            </p>
            {(!yours.address || editAddress) && !theirs.tracking ? (
              <form
                className="swap-form"
                onSubmit={(event) => {
                  const address = formValues(event);
                  void save("shipment", { action: "address", address }, () =>
                    setEditAddress(false),
                  );
                }}
              >
                <h3>Your receiving address</h3>
                <label>
                  Recipient name
                  <input
                    name="name"
                    maxLength={80}
                    defaultValue={yours.address?.name}
                    required
                  />
                </label>
                <label>
                  Street address
                  <input
                    name="street"
                    maxLength={100}
                    defaultValue={yours.address?.street}
                    required
                  />
                </label>
                <label>
                  Apartment or unit <span>Optional</span>
                  <input
                    name="unit"
                    maxLength={40}
                    defaultValue={yours.address?.unit}
                  />
                </label>
                <div className="swap-address-row">
                  <label>
                    City
                    <input
                      name="city"
                      maxLength={80}
                      defaultValue={yours.address?.city}
                      required
                    />
                  </label>
                  <label>
                    State code
                    <input
                      name="state"
                      maxLength={2}
                      minLength={2}
                      placeholder="CA"
                      defaultValue={yours.address?.state}
                      required
                    />
                  </label>
                  <label>
                    ZIP code
                    <input
                      name="zip"
                      inputMode="numeric"
                      maxLength={10}
                      defaultValue={yours.address?.zip}
                      required
                    />
                  </label>
                </div>
                <div className="swap-inline-actions">
                  <button className="button" disabled={busy}>
                    Share address
                  </button>
                  {editAddress && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditAddress(false)}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="swap-inline-actions">
                <span className="swap-subtle">
                  Your address is shared with your trade partner.
                </span>
                {!theirs.tracking && (
                  <button
                    className="text-button"
                    onClick={() => setEditAddress(true)}
                  >
                    Edit address
                  </button>
                )}
              </div>
            )}
            {theirs.address ? (
              <address className="swap-address">
                <strong>Send to</strong>
                {theirs.address.name}
                <br />
                {theirs.address.street}
                {theirs.address.unit && `, ${theirs.address.unit}`}
                <br />
                {theirs.address.city}, {theirs.address.state}{" "}
                {theirs.address.zip}
              </address>
            ) : (
              <p className="swap-subtle">Waiting for their receiving address</p>
            )}
            {yours.address &&
              theirs.address &&
              (yours.tracking && !editTracking ? (
                <div className="swap-inline-actions">
                  <ParcelTracking
                    direction="Outgoing parcel"
                    tracking={yours.tracking}
                  />
                  {canTrack && (
                    <button
                      className="text-button"
                      onClick={() => setEditTracking(true)}
                    >
                      Edit tracking
                    </button>
                  )}
                </div>
              ) : (
                canTrack && (
                  <form
                    className="swap-form"
                    onSubmit={(event) => {
                      const values = formValues(event);
                      void save(
                        "shipment",
                        { action: "tracking", ...values },
                        () => setEditTracking(false),
                      );
                    }}
                  >
                    <div className="swap-tracking-row">
                      <label>
                        Carrier
                        <input
                          name="carrier"
                          placeholder="e.g. USPS"
                          minLength={2}
                          maxLength={32}
                          defaultValue={yours.tracking?.carrier}
                          required
                        />
                      </label>
                      <label>
                        Tracking number
                        <input
                          name="code"
                          minLength={6}
                          maxLength={40}
                          defaultValue={yours.tracking?.code}
                          required
                        />
                      </label>
                    </div>
                    <div className="swap-inline-actions">
                      <button className="button" disabled={busy}>
                        Save tracking
                      </button>
                      {editTracking && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setEditTracking(false)}
                        >
                          Cancel edit
                        </button>
                      )}
                    </div>
                  </form>
                )
              ))}
            {theirs.tracking && (
              <ParcelTracking
                direction="Incoming parcel"
                tracking={theirs.tracking}
              />
            )}
          </div>
        )}
      {arrangedShipping && trade.state === "completed" && (
        <div className="swap-shipping-details">
          {yours?.tracking && (
            <ParcelTracking
              direction="Outgoing parcel"
              tracking={yours.tracking}
            />
          )}
          {theirs?.tracking && (
            <ParcelTracking
              direction="Incoming parcel"
              tracking={theirs.tracking}
            />
          )}
        </div>
      )}
      {error && <ErrorBox error={error} />}
    </section>
  );
}
