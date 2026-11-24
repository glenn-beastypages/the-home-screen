import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Plus } from "lucide-react";
import {
  api,
  ApiError,
  money,
  requestId,
  startListingConversation,
  withoutBase,
  type Fulfillment,
  type Listing,
  type Page,
  type Profile,
  type Slot,
  type Trade,
} from "./api";
import {
  Dialog,
  Empty,
  ErrorBox,
  Link,
  Loading,
  Photo,
  Spinner,
  useApp,
  useResource,
} from "./ui";
import { ShippingTerms, type TradeOptions } from "./shipping";

export function totalValue(items: Listing[]) {
  return {
    cents: items.reduce((total, item) => total + (item.priceCents ?? 0), 0),
    unpriced: items.filter((item) => item.priceCents === null).length,
  };
}

export function tradeSides(trade: Trade, userId: string) {
  return trade.sender.id === userId
    ? {
        yours: trade.offeredItems,
        theirs: trade.requestedItems,
        other: trade.recipient,
      }
    : {
        yours: trade.requestedItems,
        theirs: trade.offeredItems,
        other: trade.sender,
      };
}

export const methodLabel = {
  meetup: "Meet in person",
  arranged_shipping: "Ship to each other",
  shipping: "Ship with card holds",
} satisfies Record<Fulfillment, string>;

function SideHeading({ title, items }: { title: string; items: Listing[] }) {
  const { cents, unpriced } = totalValue(items);
  const hasPrice = items.length > unpriced;
  return (
    <header className="swap-side-heading">
      <h3>{title}</h3>
      <span className="swap-value">
        {hasPrice ? money(cents) : "—"}
        <small>
          {unpriced > 0
            ? `${unpriced} unpriced`
            : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        </small>
      </span>
    </header>
  );
}

function ItemText({ item }: { item: Listing }) {
  return (
    <span className="swap-item-text">
      <strong>{item.title}</strong>
      <small>
        {item.code} · {item.condition} ·{" "}
        {item.priceCents === null ? "Unpriced" : money(item.priceCents)}
      </small>
    </span>
  );
}

export function SwapSummary({
  yours,
  theirs,
  state,
}: {
  yours: Listing[];
  theirs: Listing[];
  state?: string;
}) {
  return (
    <div className="swap-summary">
      <div className="swap-sides">
        {[
          { title: "Your items", items: yours },
          { title: "Their items", items: theirs },
        ].map(({ title, items }) => (
          <section key={title} className="swap-side" aria-label={title}>
            <SideHeading title={title} items={items} />
            <ul className="swap-items">
              {items.map((item) => (
                <li key={item.id}>
                  <Link className="swap-item" to={`/items/${item.id}`}>
                    <Photo listing={item} />
                    <ItemText item={item} />
                    <ArrowUpRight size={13} aria-hidden />
                  </Link>
                  {["accepted", "disputed", "completed"].includes(
                    state ?? "",
                  ) && (
                    <span
                      className={`swap-item-state status-${state === "completed" ? "traded" : "reserved"}`}
                    >
                      {state === "completed" ? "Traded" : "Reserved"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="swap-value-note">Estimated value from listing prices</p>
    </div>
  );
}

export const isTradeable = (item: Listing) =>
  item.status === "active" &&
  item.tradeEnabled &&
  !item.owner.isDemo &&
  !item.isHidden;

function PickerSide({
  title,
  items,
  selected,
  onToggle,
  empty,
}: {
  title: string;
  items: Listing[];
  selected: Listing[];
  onToggle: (item: Listing) => void;
  empty?: string;
}) {
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const addCode = () => {
    const match = /^([A-Z])-?([1-3])$/.exec(
      code.trim().toUpperCase().replace(/\s/g, ""),
    );
    const item =
      match && items.find((entry) => entry.code === match[1] + "-" + match[2]);
    if (!match) {
      setNotice("Enter a shelf code like A-1.");
      return;
    }
    if (!item) {
      setNotice(
        "No available trade item at " + match[1] + "-" + match[2] + ".",
      );
      return;
    }
    if (selected.some((entry) => entry.id === item.id)) {
      setNotice(item.code + " is already added.");
      return;
    }
    if (selected.length >= 10) {
      setNotice("Remove an item before adding another.");
      return;
    }
    onToggle(item);
    setCode("");
    setNotice("");
  };
  const ordered = [
    ...selected,
    ...items.filter((item) => !selected.some((entry) => entry.id === item.id)),
  ];
  return (
    <section className="swap-side" aria-label={title}>
      <SideHeading title={title} items={selected} />
      {items.length ? (
        <>
          <div className="swap-code">
            <input
              aria-label={
                title === "Your items" ? "Your shelf code" : "Their shelf code"
              }
              placeholder="Shelf code"
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setNotice("");
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                if (code.trim()) addCode();
              }}
            />
            <button
              type="button"
              className="text-button"
              disabled={!code.trim()}
              onClick={addCode}
            >
              Add
            </button>
          </div>
          {notice && (
            <p className="swap-code-notice" role="status">
              {notice}
            </p>
          )}
          <ul className="swap-items swap-picker-list">
            {ordered.map((item) => {
              const active = selected.some((chosen) => chosen.id === item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="swap-item swap-choice"
                    aria-label={item.title}
                    aria-pressed={active}
                    disabled={selected.length >= 10 && !active}
                    onClick={() => onToggle(item)}
                  >
                    <Photo listing={item} />
                    <ItemText item={item} />
                    <span className="swap-choice-icon">
                      {active ? <Check size={15} /> : <Plus size={15} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="swap-picker-empty">{empty}</p>
      )}
    </section>
  );
}

export function TradeComposer({
  target,
  theirListing,
  yourListing,
  trade,
  other: participant,
  onClose,
  onUpdate,
}: {
  target?: Listing;
  theirListing?: Listing;
  yourListing?: Listing;
  trade?: Trade;
  other?: Profile;
  onClose: () => void;
  onUpdate?: (trade: Trade) => void;
}) {
  const { go, user } = useApp();
  const requested = target ?? theirListing;
  const other = participant ?? requested?.owner;
  const original = trade && user ? tradeSides(trade, user.id) : null;
  const inventory = useResource<{ slots: Slot[] }>("/me/inventory");
  const shelf = useResource<Page<Listing>>(
    other
      ? `/listings?seller=${encodeURIComponent(other.id)}&tradeOnly=true&limit=78`
      : null,
  );
  const options = useResource<TradeOptions>("/trade-options");
  const [ownIds, setOwnIds] = useState<string[]>(
    () =>
      original?.yours.map((item) => item.id) ??
      (yourListing ? [yourListing.id] : []),
  );
  const [theirIds, setTheirIds] = useState<string[]>(
    () =>
      original?.theirs.map((item) => item.id) ??
      (requested ? [requested.id] : []),
  );
  const [method, setMethod] = useState<Fulfillment>(
    trade?.fulfillment ?? "meetup",
  );
  const [balance, setBalance] = useState(Boolean(trade?.cashDifferenceCents));
  const [cashAmount, setCashAmount] = useState(
    trade?.cashDifferenceCents
      ? (trade.cashDifferenceCents / 100).toFixed(2)
      : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const request = useRef<{ payload: string; key: string }>();
  const mine =
    inventory.data?.slots.flatMap(({ listing }) =>
      listing && isTradeable(listing) ? [listing] : [],
    ) ?? [];
  const partner = shelf.data?.items.filter(isTradeable) ?? [];
  const yours = ownIds.flatMap(
    (itemId) => mine.find((item) => item.id === itemId) ?? [],
  );
  const theirs = theirIds.flatMap(
    (itemId) => partner.find((item) => item.id === itemId) ?? [],
  );
  const ownValue = totalValue(yours);
  const otherValue = totalValue(theirs);
  const difference = Math.abs(ownValue.cents - otherValue.cents);
  const hasCashAdjustment =
    method === "shipping" && balance && difference >= 50;
  const cashCents = Math.round(Number(cashAmount) * 100);
  const validCash =
    !hasCashAdjustment ||
    (/^\d+(?:\.\d{1,2})?$/.test(cashAmount) &&
      cashCents >= 50 &&
      cashCents <= difference);
  const canHold = Boolean(
    options.data?.shipping &&
    yours.length &&
    theirs.length &&
    [...yours, ...theirs].every((item) => (item.priceCents ?? 0) >= 50) &&
    Math.max(ownValue.cents, otherValue.cents) <= options.data.maxShippedValue,
  );
  const staleItems =
    ownIds.length !== yours.length || theirIds.length !== theirs.length;
  const ready = Boolean(
    yours.length &&
    theirs.length &&
    !staleItems &&
    validCash &&
    (method !== "shipping" || canHold),
  );
  const reload = () => {
    inventory.reload();
    shelf.reload();
  };
  const toggle = (
    item: Listing,
    ids: string[],
    update: (ids: string[]) => void,
  ) => {
    update(
      ids.includes(item.id)
        ? ids.filter((itemId) => itemId !== item.id)
        : [...ids, item.id],
    );
    setSendError("");
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    const payload = {
      offeredListingIds: yours.map((item) => item.id),
      requestedListingIds: theirs.map((item) => item.id),
      fulfillment: method,
      ...(hasCashAdjustment ? { cashAdjustmentCents: cashCents } : {}),
      message: note.trim(),
      ...(trade ? { expectedRevision: trade.revision } : {}),
    };
    const signature = JSON.stringify(payload);
    if (request.current?.payload !== signature)
      request.current = { payload: signature, key: requestId() };
    setBusy(true);
    setSendError("");
    try {
      const { trade: saved } = await api<{ trade: Trade }>(
        trade ? `/trades/${trade.id}/counter` : "/trades",
        "POST",
        { ...payload, clientRequestId: request.current.key },
      );
      if (onUpdate) onUpdate(saved);
      else go("/trades/" + saved.id);
      onClose();
    } catch (error) {
      setSendError((error as Error).message);
      if (error instanceof ApiError && error.code === "ITEM_UNAVAILABLE")
        reload();
    } finally {
      setBusy(false);
    }
  }

  const interestItem = !trade && !participant?.isDemo && theirs[0];
  const messageSeller = async () => {
    if (!interestItem || busy) return;
    setBusy(true);
    setSendError("");
    try {
      go((await startListingConversation(interestItem)) + "?tradeInterest=1");
      onClose();
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadError = inventory.error || shelf.error;
  const readyToPick = !inventory.loading && !shelf.loading && !loadError;
  return (
    <Dialog
      title={trade ? "Make a counteroffer" : "Make a trade offer"}
      className="swap-composer"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="swap-composer-form" onSubmit={send}>
        <div className="swap-composer-body">
          {loadError ? (
            <ErrorBox error={loadError} retry={reload} />
          ) : !readyToPick ? (
            <Loading />
          ) : !mine.length && !partner.length ? (
            <Empty
              title="List something to trade"
              body="Enable trades on your listing."
              action={{
                label: "List an item",
                to:
                  "/sell/new?returnTo=" +
                  encodeURIComponent(
                    trade
                      ? `/trades/${trade.id}`
                      : withoutBase(location.pathname) + "?offer=1",
                  ),
              }}
            />
          ) : (
            <>
              {staleItems && (
                <div className="swap-picker-alert" role="status">
                  An item is unavailable.{" "}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setOwnIds(yours.map((item) => item.id));
                      setTheirIds(theirs.map((item) => item.id));
                    }}
                  >
                    Remove unavailable items
                  </button>
                </div>
              )}
              <div className="swap-sides">
                <PickerSide
                  title="Your items"
                  items={mine}
                  selected={yours}
                  onToggle={(item) => toggle(item, ownIds, setOwnIds)}
                  empty="List an item and turn on trades to make an offer."
                />
                <PickerSide
                  title="Their items"
                  items={partner}
                  selected={theirs}
                  onToggle={(item) => toggle(item, theirIds, setTheirIds)}
                  empty="This seller has no available trade listings."
                />
              </div>
              <p className="swap-value-note">
                Estimated value from listing prices
              </p>
              {!mine.length && (
                <Link
                  className="text-button"
                  to={
                    "/sell/new?returnTo=" +
                    encodeURIComponent(
                      withoutBase(location.pathname) + "?offer=1",
                    )
                  }
                >
                  List an item
                </Link>
              )}
              {mine.length > 0 && interestItem && !yours.length && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={messageSeller}
                >
                  Message about trading
                </button>
              )}
              {mine.length > 0 && (
                <fieldset className="swap-method">
                  <legend>Exchange method</legend>
                  {(
                    [
                      "meetup",
                      "arranged_shipping",
                      ...(options.data?.shipping || method === "shipping"
                        ? ["shipping"]
                        : []),
                    ] as Fulfillment[]
                  ).map((key) => (
                    <label key={key}>
                      <input
                        type="radio"
                        name="exchange-method"
                        value={key}
                        checked={method === key}
                        onChange={() => setMethod(key)}
                      />
                      {methodLabel[key]}
                    </label>
                  ))}
                </fieldset>
              )}
              {method === "arranged_shipping" && (
                <p className="swap-method-note">
                  Buy your own postage and share tracking here. BSTY doesn’t
                  cover lost or damaged parcels.
                </p>
              )}
              {method === "shipping" &&
                (canHold ? (
                  <>
                    {difference >= 50 && (
                      <label className="swap-balance">
                        <input
                          type="checkbox"
                          checked={balance}
                          onChange={(e) => {
                            setBalance(e.target.checked);
                            setCashAmount(
                              e.target.checked
                                ? (difference / 100).toFixed(2)
                                : "",
                            );
                          }}
                        />
                        {ownValue.cents < otherValue.cents
                          ? "Add cash to my offer"
                          : "Request cash to balance the trade"}
                      </label>
                    )}
                    {hasCashAdjustment && (
                      <label className="swap-note">
                        Cash amount
                        <input
                          value={cashAmount}
                          inputMode="decimal"
                          onChange={(e) => setCashAmount(e.target.value)}
                          aria-invalid={!validCash}
                          aria-describedby="swap-cash-range"
                        />
                        <small id="swap-cash-range">
                          Enter $0.50 to {money(difference)}.
                        </small>
                      </label>
                    )}
                    <ShippingTerms
                      yours={ownValue.cents}
                      theirs={otherValue.cents}
                      cash={hasCashAdjustment && validCash ? cashCents : 0}
                    />
                  </>
                ) : (
                  <p className="swap-method-note">
                    Card holds need a listed price on every item and an eligible
                    total on each side.
                  </p>
                ))}
              {mine.length > 0 && (
                <label className="swap-note">
                  Add a message <span>Optional</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Tell them what you have in mind"
                  />
                </label>
              )}
            </>
          )}
          {sendError && <ErrorBox error={sendError} />}
        </div>
        {readyToPick && (mine.length > 0 || interestItem) && (
          <footer className="swap-composer-footer">
            <span aria-live="polite">
              {ready
                ? `${yours.length} to give · ${theirs.length} to get`
                : yours.length && theirs.length
                  ? "Review selected items"
                  : "Select an item on each side"}
            </span>
            {!mine.length && interestItem ? (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={messageSeller}
              >
                {busy && <Spinner />}
                Message about trading
              </button>
            ) : (
              <button
                className="button"
                type="submit"
                disabled={busy || !ready}
              >
                {busy && <Spinner />}
                {trade ? "Send counteroffer" : "Send offer"}
              </button>
            )}
          </footer>
        )}
      </form>
    </Dialog>
  );
}
