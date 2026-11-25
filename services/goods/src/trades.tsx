import { PracticeHistory } from "./practice";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Clock3,
  Flag,
  MessageCircle,
} from "lucide-react";
import { api, ApiError, requestId, time, type Page, type Trade } from "./api";
import {
  Avatar,
  Dialog,
  Empty,
  ErrorBox,
  Link,
  Loading,
  Photo,
  SignedOut,
  Spinner,
  useApp,
  useResource,
} from "./ui";
import { ShippingPanel, ShippingTerms, type ShippingView } from "./shipping";
import {
  methodLabel,
  SwapSummary,
  totalValue,
  TradeComposer,
  tradeSides,
} from "./trade-offer";
import { ExchangePlanPanel } from "./trade-exchange";
import { TradeThread } from "./trade-thread";
import "./trades.css";

export { TradeComposer } from "./trade-offer";

function statusText(trade: Trade, userId: string) {
  switch (trade.state) {
    case "pending":
      return trade.proposedBy === userId ? "Waiting for reply" : "Your turn";
    case "accepted":
      return trade.cancelRequestedBy.length
        ? "Cancellation requested"
        : "Exchange in progress";
    case "completed":
      return "Completed";
    case "disputed":
      return "Under review";
    case "invalidated":
      return "Item unavailable";
    default:
      return trade.state.charAt(0).toUpperCase() + trade.state.slice(1);
  }
}

const tradeTabs = [
  { id: "open", label: "Open" },
  { id: "received", label: "Your turn" },
  { id: "history", label: "History" },
] as const;

export function Trades() {
  const { user } = useApp();
  if (!user) return <SignedOut what="view your trades" />;
  const selection = new URLSearchParams(window.location.search).get("tab");
  const tab =
    selection === "history" ||
    selection === "received" ||
    selection === "sent" ||
    selection === "accepted"
      ? selection
      : "open";
  return (
    <div className="swap-page">
      <header className="swap-index-heading">
        <h1>Trades</h1>
        <Link className="button secondary" to="/explore?tradeOnly=true">
          Browse tradeable items <ArrowUpRight size={16} />
        </Link>
      </header>
      <nav className="swap-tabs" aria-label="Filter trades">
        {tradeTabs.map(({ id, label }) => (
          <Link
            key={id}
            to={`/trades?tab=${id}`}
            aria-current={
              tab === id ||
              (id === "open" && ["sent", "accepted"].includes(tab))
                ? "page"
                : undefined
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      <TradeList key={tab} tab={tab} userId={user.id} />
    </div>
  );
}

function TradeList({ tab, userId }: { tab: string; userId: string }) {
  const path = `/trades?tab=${tab}`;
  const { data, loading, error, reload } = useResource<Page<Trade>>(path);
  const [more, setMore] = useState<Page<Trade>[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const rows = [
    ...new Map(
      [...(data?.items ?? []), ...more.flatMap((page) => page.items)].map(
        (item) => [item.id, item],
      ),
    ).values(),
  ];
  const next = (more.at(-1) ?? data)?.nextCursor;
  async function loadMore() {
    setBusy(true);
    setLoadError("");
    try {
      const page = await api<Page<Trade>>(
        path + "&cursor=" + encodeURIComponent(next!),
      );
      setMore((before) => [...before, page]);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!rows.length)
    return (
      <PracticeHistory
        kind="trade"
        tab={tab}
        empty={
          <Empty
            title={
              tab === "history"
                ? "No past trades"
                : tab === "received"
                  ? "You’re all caught up"
                  : "No open trades"
            }
            body={
              tab === "open"
                ? "Pick an item you want and offer something from your shelf."
                : ""
            }
            action={{
              label:
                tab === "received"
                  ? "View open trades"
                  : "Find something to trade",
              to: tab === "received" ? "/trades" : "/explore?tradeOnly=true",
            }}
          />
        }
      />
    );
  return (
    <>
      <PracticeHistory kind="trade" tab={tab} />
      <ul className="swap-inbox-list">
        {rows.map((trade) => {
          const { yours, theirs, other } = tradeSides(trade, userId);
          const needsReply =
            trade.state === "pending" && trade.proposedBy !== userId;
          return (
            <li key={trade.id}>
              <Link className="swap-inbox-row" to={"/trades/" + trade.id}>
                <div className="swap-inbox-photos">
                  <Photo listing={yours[0]} />
                  <Photo listing={theirs[0]} />
                </div>
                <div className="swap-inbox-label">
                  <strong>{other.name}</strong>
                  <span>
                    {theirs[0].title}
                    {theirs.length > 1 ? ` +${theirs.length - 1}` : ""}
                  </span>
                  <small>
                    {yours.length} for {theirs.length} ·{" "}
                    {methodLabel[trade.fulfillment]}
                  </small>
                </div>
                <span
                  className={`swap-status ${needsReply ? "needs-reply" : ""}`}
                >
                  {statusText(trade, userId)}
                </span>
                <ArrowUpRight
                  className="swap-inbox-arrow"
                  size={17}
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
      {loadError && <ErrorBox error={loadError} />}
      {next && (
        <button className="button secondary" disabled={busy} onClick={loadMore}>
          {busy ? <Spinner /> : "Load more"}
        </button>
      )}
    </>
  );
}

type Action =
  "accept" | "decline" | "withdraw" | "confirm" | "cancel" | "dispute";
const actionCopy = {
  accept: {
    title: "Accept this offer?",
    body: "This reserves every item in the offer for your exchange.",
    label: "Accept trade",
  },
  decline: {
    title: "Decline this offer?",
    body: "The offer will close and the items will stay available.",
    label: "Decline offer",
  },
  withdraw: {
    title: "Withdraw your offer?",
    body: "The other person will no longer be able to accept it.",
    label: "Withdraw offer",
  },
  confirm: {
    title: "Did you receive your items?",
    body: "Confirm after you’ve received and checked the items. The trade completes once you both confirm.",
    label: "Confirm receipt",
  },
  cancel: {
    title: "Cancel this trade?",
    body: "The items stay reserved until you both agree to cancel.",
    label: "Request cancellation",
  },
  dispute: {
    title: "Report a problem",
    body: "The items stay reserved while support reviews the trade.",
    label: "Send report",
  },
} satisfies Record<Action, { title: string; body: string; label: string }>;

export function TradePage({ id }: { id: string }) {
  const { user } = useApp();
  if (!user) return <SignedOut what="view this trade" />;
  return <TradeWorkspace key={id} id={id} userId={user.id} />;
}

function TradeWorkspace({ id, userId }: { id: string; userId: string }) {
  const path = "/trades/" + id;
  const [trade, setTrade] = useState<Trade | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [action, setAction] = useState<{
    name: Action;
    revision: number;
    version?: number;
    clientKey: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [counter, setCounter] = useState<Trade | null>(null);
  const poll = useRef<() => void>(() => {});
  const command = useRef(0);
  const protectedShipping = trade?.fulfillment === "shipping";
  const shippingPath =
    protectedShipping &&
    ["accepted", "disputed", "completed", "canceled"].includes(
      trade?.state ?? "",
    )
      ? path + "/shipping"
      : null;
  const [returnedFromShipping] = useState(
    () =>
      new URLSearchParams(window.location.search).get("shipping") === "return",
  );
  const shipping = useResource<ShippingView>(
    shippingPath && returnedFromShipping
      ? shippingPath + "/refresh"
      : shippingPath,
    returnedFromShipping ? "POST" : "GET",
  );
  function apply(next: Trade) {
    command.current++;
    setTrade(next);
  }

  useEffect(() => {
    let mounted = true;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const version = command.current;
      try {
        const { trade: next } = await api<{ trade: Trade }>(path);
        if (mounted && command.current === version) {
          setTrade(next);
          setLoadError("");
        }
      } catch (error) {
        if (mounted && command.current === version)
          setLoadError((error as Error).message);
      } finally {
        pending = false;
        if (mounted) setLoading(false);
      }
    };
    poll.current = load;
    void load();
    const timer = setInterval(load, 4500);
    window.addEventListener("focus", load);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [path]);

  useEffect(() => {
    if (!returnedFromShipping || !shipping.data) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("shipping") !== "return") return;
    url.searchParams.delete("shipping");
    window.history.replaceState(window.history.state, "", url);
    poll.current();
  }, [returnedFromShipping, shipping.data]);

  if (loading) return <Loading />;
  if (!trade)
    return (
      <ErrorBox
        error={loadError || "This trade is unavailable."}
        retry={() => poll.current()}
      />
    );
  const { yours, theirs, other } = tradeSides(trade, userId);
  const pending = trade.state === "pending";
  const incoming = trade.proposedBy !== userId;
  const accepted = trade.state === "accepted";
  const completed = trade.state === "completed";
  const confirmed = trade.confirmedBy.includes(userId);
  const theirReceipt = trade.confirmedBy.includes(other.id);
  const cancelRequested = trade.cancelRequestedBy.length > 0;
  const youRequested = trade.cancelRequestedBy.includes(userId);
  const canCancel =
    accepted &&
    !trade.confirmedBy.length &&
    !youRequested &&
    !trade.shipments?.yours.tracking &&
    !trade.shipments?.theirs.tracking &&
    (!protectedShipping || shipping.data?.canCancel);
  const planAgreed = trade.exchangePlan?.confirmedBy.length === 2;
  const canConfirm =
    accepted &&
    !confirmed &&
    !cancelRequested &&
    (!trade.planRequired || planAgreed) &&
    (trade.fulfillment !== "arranged_shipping" ||
      Boolean(
        trade.shipments?.yours.tracking && trade.shipments?.theirs.tracking,
      )) &&
    (!protectedShipping || shipping.data?.canConfirm);
  const arranged = trade.fulfillment === "arranged_shipping";
  const method = methodLabel[trade.fulfillment];

  function choose(name: Action) {
    setReason("");
    setActionError("");
    setAction({
      name,
      revision: trade!.revision,
      version: trade!.exchangePlan?.version,
      clientKey: requestId(),
    });
  }

  async function submit() {
    if (!action || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const { trade: next } = await api<{ trade: Trade }>(
        path + "/actions",
        "POST",
        {
          action: action.name,
          clientRequestId: action.clientKey,
          expectedRevision: action.revision,
          planVersion: action.version,
          reason: reason.trim(),
        },
      );
      apply(next);
      setAction(null);
      if (
        shippingPath &&
        (action.name === "confirm" || action.name === "cancel")
      ) {
        void api<ShippingView>(shippingPath + "/refresh", "POST")
          .then((view) => {
            shipping.setData(view);
            poll.current();
          })
          .catch(() => shipping.reload());
      }
    } catch (error) {
      setActionError((error as Error).message);
      if (error instanceof ApiError && error.status === 409) poll.current();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="swap-page">
      <Link className="swap-back" to="/trades">
        <ArrowLeft size={16} /> Trades
      </Link>
      <header className="swap-workspace-heading">
        <div className="swap-partner">
          <Link
            to={"/sellers/" + other.id}
            aria-label={other.name + "’s profile"}
          >
            <Avatar profile={other} size={42} />
          </Link>
          <div>
            <h1>Trade with {other.name}</h1>
            <span>{method}</span>
          </div>
        </div>
        <span
          className={`swap-status ${pending && incoming ? "needs-reply" : ""}`}
        >
          {statusText(trade, userId)}
        </span>
      </header>
      {loadError && <ErrorBox error={loadError} retry={() => poll.current()} />}
      <div className="swap-workspace">
        <div className="swap-workspace-main">
          <section className="swap-current" aria-label="Trade items">
            <div className="swap-section-heading">
              <ArrowLeftRight size={19} aria-hidden />
              <h2>
                {pending
                  ? "Current offer"
                  : accepted || completed
                    ? "Agreed items"
                    : "Trade items"}
              </h2>
              {pending && (
                <span>
                  <Clock3 size={13} aria-hidden /> Expires{" "}
                  {time(trade.expiresAt)}
                </span>
              )}
            </div>
            <SwapSummary yours={yours} theirs={theirs} state={trade.state} />
            {protectedShipping && pending && (
              <ShippingTerms
                yours={totalValue(yours).cents}
                theirs={totalValue(theirs).cents}
                cash={trade.cashDifferenceCents}
              />
            )}
            {pending && (
              <div className="swap-controls">
                {incoming ? (
                  <>
                    <button className="button" onClick={() => choose("accept")}>
                      Accept trade
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setCounter(trade)}
                    >
                      Counteroffer
                    </button>
                    <button
                      className="text-button"
                      onClick={() => choose("decline")}
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => choose("withdraw")}
                  >
                    Withdraw offer
                  </button>
                )}
              </div>
            )}
            {trade.conversationId && (
              <div className="swap-controls swap-jump-row">
                <a
                  href="#trade-conversation"
                  className="text-button swap-thread-jump"
                >
                  <MessageCircle size={16} /> Conversation
                </a>
              </div>
            )}
          </section>
          {(accepted || completed) &&
            (!protectedShipping || trade.planRequired) && (
              <ExchangePlanPanel
                trade={trade}
                onUpdate={apply}
                protectedShipBy={shipping.data?.shipBy}
              />
            )}
          {shippingPath && shipping.loading && <Loading />}
          {shippingPath && shipping.error && (
            <ErrorBox error={shipping.error} retry={shipping.reload} />
          )}
          {shippingPath &&
            shipping.data &&
            (!trade.planRequired ||
              planAgreed ||
              trade.state !== "accepted") && (
              <ShippingPanel
                id={id}
                details={shipping.data}
                onRefresh={(view) => {
                  shipping.setData(view);
                  if (view.tradeState !== trade.state) poll.current();
                }}
              />
            )}
          {(accepted || completed) && (
            <section className="swap-receipt" aria-label="Receipt confirmation">
              <div className="swap-section-heading">
                <Check size={19} aria-hidden />
                <h2>{completed ? "Trade complete" : "Confirm receipt"}</h2>
              </div>
              <div className="swap-confirmations">
                <span>
                  {confirmed ? "✓ You confirmed" : "You · awaiting receipt"}
                </span>
                <span>
                  {theirReceipt
                    ? `✓ ${other.name} confirmed`
                    : `${other.name} · awaiting receipt`}
                </span>
              </div>
              {accepted && (
                <div className="swap-controls">
                  {canConfirm && (
                    <button
                      className="button"
                      onClick={() => choose("confirm")}
                    >
                      I received my items
                    </button>
                  )}
                  {arranged &&
                    planAgreed &&
                    !canConfirm &&
                    !confirmed &&
                    !cancelRequested && (
                      <span className="swap-subtle">
                        Add tracking for both parcels to confirm receipt.
                      </span>
                    )}
                  {canCancel && (
                    <button
                      className="text-button"
                      onClick={() => choose("cancel")}
                    >
                      {cancelRequested
                        ? "Agree to cancel"
                        : "Request cancellation"}
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={Boolean(shipping.data?.resolving)}
                    onClick={() => choose("dispute")}
                  >
                    <Flag size={15} /> Report a problem
                  </button>
                </div>
              )}
            </section>
          )}
          {!pending && !accepted && !completed && (
            <div className="swap-controls">
              <Link className="button secondary" to="/explore?tradeOnly=true">
                Browse tradeable items
              </Link>
            </div>
          )}
        </div>
        <TradeThread trade={trade} onActivity={() => poll.current()} />
      </div>
      {counter && (
        <TradeComposer
          trade={counter}
          other={other}
          onUpdate={apply}
          onClose={() => setCounter(null)}
        />
      )}
      {action && (
        <Dialog
          title={actionCopy[action.name].title}
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <p className="muted">
            {protectedShipping && action.name === "confirm"
              ? "Confirm after checking the parcel. Once you both confirm, BSTY settles any agreed cash difference and releases the rest of the holds."
              : actionCopy[action.name].body}
          </p>
          {action.name === "dispute" && (
            <label>
              What happened?
              <textarea
                value={reason}
                rows={4}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          {actionError && <ErrorBox error={actionError} />}
          <div className="actions end">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              Go back
            </button>
            <button
              className="button"
              disabled={
                busy || (action.name === "dispute" && reason.trim().length < 3)
              }
              onClick={submit}
            >
              {busy && <Spinner />}
              {action.name === "cancel" && cancelRequested
                ? "Agree to cancel"
                : actionCopy[action.name].label}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
