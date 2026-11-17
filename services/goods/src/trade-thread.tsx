import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, Send } from "lucide-react";
import {
  api,
  requestId,
  time,
  type Message,
  type Page,
  type Trade,
} from "./api";
import { ErrorBox, Loading, ReportButton, Spinner, useApp } from "./ui";
import { methodLabel, SwapSummary } from "./trade-offer";

const eventLabels: Record<string, string> = {
  proposed: "Offer sent",
  countered: "Counteroffer sent",
  accept: "Accepted the offer",
  decline: "Declined the offer",
  withdraw: "Withdrew the offer",
  expired: "The offer expired",
  invalidated: "An item became unavailable",
  plan_proposed: "Suggested an exchange plan",
  plan_confirmed: "Confirmed the exchange plan",
  address_shared: "Shared a receiving address",
  tracking_added: "Added parcel tracking",
  confirm: "Confirmed receipt",
  cancel: "Requested cancellation",
  canceled: "The trade was canceled",
  completed: "The trade is complete",
  dispute: "Reported a problem",
  operator_completed: "Support marked the trade complete",
  operator_canceled: "Support canceled the trade",
  shipping_review: "Shipping needs review",
  settlement_requested: "Resolving shipping charges",
  operator_settlement_requested: "Support started a shipping resolution",
};

export function TradeThread({
  trade,
  onActivity,
}: {
  trade: Trade;
  onActivity: () => void;
}) {
  const { user } = useApp();
  const base = "/conversations/" + trade.conversationId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false);
  const [readError, setReadError] = useState("");
  const [sendError, setSendError] = useState("");
  const sent = useRef<{ body: string; key: string }>();
  const seen = useRef("");
  const log = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const activity = useRef(onActivity);
  activity.current = onActivity;
  const merge = (items: Message[]) =>
    setMessages((before) => {
      const byId = new Map(
        [...before, ...items].map((item) => [item.id, item]),
      );
      return [...byId.values()];
    });

  useEffect(() => {
    if (!trade.conversationId) return;
    let mounted = true;
    let pending = false;
    let first = true;
    async function poll() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const page = await api<Page<Message>>(base + "/messages");
        if (!mounted) return;
        merge(page.items);
        if (first) setNext(page.nextCursor);
        first = false;
        setReadError("");
        const newest = page.items.at(-1)?.id;
        if (newest && newest !== seen.current) {
          await api(base + "/read", "POST", {});
          if (mounted) seen.current = newest;
        }
      } catch (error) {
        if (mounted) setReadError((error as Error).message);
      } finally {
        pending = false;
        if (mounted) setLoading(false);
      }
    }
    void poll();
    const timer = setInterval(poll, 4500);
    window.addEventListener("focus", poll);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [base, trade.conversationId]);

  async function earlier() {
    if (!next || older) return;
    setOlder(true);
    atEnd.current = false;
    try {
      const page = await api<Page<Message>>(
        base + "/messages?cursor=" + encodeURIComponent(next),
      );
      merge(page.items);
      setNext(page.nextCursor);
    } catch (error) {
      setReadError((error as Error).message);
    } finally {
      setOlder(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = message.trim();
    if (!body || busy) return;
    if (sent.current?.body !== body) sent.current = { body, key: requestId() };
    setBusy(true);
    setSendError("");
    try {
      const result = await api<{ message: Message }>(
        base + "/messages",
        "POST",
        { body, clientRequestId: sent.current.key },
      );
      atEnd.current = true;
      merge([result.message]);
      setMessage("");
      sent.current = undefined;
      activity.current();
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const el = log.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, trade.events.length, loading]);

  if (!trade.conversationId) return null;
  const displayName = (actor: string | null) =>
    actor === user?.id
      ? "You"
      : actor === trade.sender.id
        ? trade.sender.name
        : actor === trade.recipient.id
          ? trade.recipient.name
          : null;
  const timeline = [
    ...trade.events.map((event) => ({ type: "event" as const, value: event })),
    ...messages.map((message) => ({
      type: "message" as const,
      value: message,
    })),
  ].sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt));

  return (
    <section className="swap-thread" aria-labelledby="trade-conversation">
      <header className="swap-section-heading">
        <h2 id="trade-conversation">Conversation</h2>
        <span>Private</span>
      </header>
      <div
        ref={log}
        onScroll={(event) => {
          const el = event.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        className="swap-log"
      >
        {loading && <Loading />}
        {readError && <ErrorBox error={readError} />}
        {!loading && !timeline.length && !readError && (
          <p className="swap-subtle">Start the conversation with a message.</p>
        )}
        {next && (
          <button className="text-button" disabled={older} onClick={earlier}>
            {older ? <Spinner /> : "Load earlier messages"}
          </button>
        )}
        {timeline.map(({ type, value }) => {
          if (type === "message") {
            const mine = value.senderId === user?.id;
            return (
              <div key={value.id} className={`swap-chat ${mine ? "mine" : ""}`}>
                <div>
                  <strong>{displayName(value.senderId)}</strong>
                  <p>{value.body}</p>
                  <time>{time(value.createdAt)}</time>
                </div>
                {!mine && (
                  <ReportButton
                    targetType="message"
                    targetId={value.id}
                    iconOnly
                  />
                )}
              </div>
            );
          }
          const who = displayName(value.actorId);
          const proposal = value.proposal;
          if (proposal) {
            const mine = trade.sender.id === user?.id;
            return (
              <details key={value.id} className="swap-event-offer">
                <summary>
                  <ArrowLeftRight size={16} aria-hidden />
                  <span>
                    <strong>
                      {value.action === "countered" ? "Counteroffer" : "Offer"}
                    </strong>{" "}
                    · {who} · {methodLabel[proposal.fulfillment]}
                  </span>
                  <time>{time(value.createdAt)}</time>
                </summary>
                <SwapSummary
                  yours={mine ? proposal.offered : proposal.requested}
                  theirs={mine ? proposal.requested : proposal.offered}
                />
              </details>
            );
          }
          return (
            <div key={value.id} className="swap-system-event">
              <span>
                {who && <strong>{who} · </strong>}
                {eventLabels[value.action] ?? "Trade updated"}
              </span>
              <time>{time(value.createdAt)}</time>
              {value.reason && <p>{value.reason}</p>}
            </div>
          );
        })}
      </div>
      <form className="swap-message-form" onSubmit={send}>
        <textarea
          rows={2}
          maxLength={2000}
          aria-label="Message"
          placeholder="Write a message"
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          className="button"
          type="submit"
          disabled={busy || !message.trim()}
          aria-label="Send message"
        >
          {busy ? <Spinner /> : <Send size={18} aria-hidden />}
        </button>
      </form>
      {sendError && <ErrorBox error={sendError} />}
    </section>
  );
}
