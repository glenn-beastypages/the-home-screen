import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, MapPin, Package, Truck } from "lucide-react";
import {
  api,
  ApiError,
  money,
  requestId,
  type Listing,
  type Slot,
} from "./api";
import {
  ErrorBox,
  Link,
  Loading,
  PageTitle,
  Photo,
  useApp,
  useResource,
} from "./ui";
import {
  practiceShelf,
  stageLabel,
  type PracticeKind,
  type Method,
  type Practice,
} from "./practice-types";

const kindNames = {
  message: "Conversation",
  purchase: "Order",
  trade: "Trade",
};
const destination = {
  message: "/inbox",
  purchase: "/orders",
  trade: "/trades",
};
const historyTitles = {
  message: "Simulated conversations",
  purchase: "Simulated orders",
  trade: "Simulated trades",
};
export function practicePath(kind: PracticeKind, id: string) {
  return "/practice/new/" + kind + "/" + id;
}
export function PracticeHistory({
  kind,
  tab,
  empty,
}: {
  kind: PracticeKind;
  tab?: string;
  empty?: ReactNode;
}) {
  const { user } = useApp();
  const resource = useResource<{ items: Practice[] }>(
    user ? "/practice?kind=" + kind : null,
  );
  if (resource.error)
    return <ErrorBox error={resource.error} retry={resource.reload} />;
  const items = (resource.data?.items ?? []).filter((row) => {
    if (!tab) return true;
    if (tab === "received") return row.state === "countered";
    if (tab === "sent") return row.state === "offered";
    if (tab === "history") return ["complete", "canceled"].includes(row.state);
    if (tab === "accepted")
      return ["confirmed", "transit", "ready", "received"].includes(row.state);
    return !["complete", "canceled"].includes(row.state);
  });
  if (!items.length) return resource.loading ? null : <>{empty}</>;
  return (
    <section className="practice-history">
      <h2>{historyTitles[kind]}</h2>
      <ul className="order-list">
        {items.map((s) => (
          <li key={s.id}>
            <Link to={"/practice/" + s.id}>
              <strong>{s.title}</strong>
              <span>
                {s.seller} · {stageLabel[s.state]}
              </span>
              <ArrowRight size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
function ItemSummary({ item }: { item: Listing }) {
  return (
    <Link className="practice-item" to={"/items/" + item.id}>
      <Photo listing={item} />
      <div>
        <small>
          {item.owner.name} · {item.code}
        </small>
        <strong>{item.title}</strong>
        <span>{money(item.priceCents)}</span>
      </div>
    </Link>
  );
}
const disclosure =
  "This seller is simulated. Messages stay in your account. No payment, shipment or meetup takes place.";
export function PracticeStart({
  id,
  kind,
}: {
  id: string;
  kind: PracticeKind;
}) {
  const { user, go, requireUser } = useApp();
  const listing = useResource<{ listing: Listing }>("/listings/" + id);
  const own = useResource<{ slots: Slot[] }>(
    user && kind === "trade" ? "/me/inventory" : null,
  );
  const history = useResource<{ items: Practice[] }>(
    user ? "/practice?kind=" + kind + "&listingId=" + id : null,
  );
  const [method, setMethod] = useState<Method>("shipping"),
    [offered, setOffered] = useState(""),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const startKey = useRef(requestId());
  const active = history.data?.items.find(
    (s) => !["complete", "canceled"].includes(s.state),
  );
  useEffect(() => {
    if (active) go("/practice/" + active.id, true);
  }, [active?.id, go]);
  const item = listing.data?.listing;
  if (listing.loading || (user && history.loading)) return <Loading />;
  if (listing.error || history.error)
    return (
      <ErrorBox
        error={listing.error || history.error}
        retry={() => {
          listing.reload();
          history.reload();
        }}
      />
    );
  if (
    !item?.owner.isDemo ||
    !item.isDemo ||
    item.isHidden ||
    item.status !== "active"
  )
    return <ErrorBox error="This simulated listing is unavailable." />;
  if (active) return <Loading />;
  const available =
    own.data?.slots.flatMap(({ listing }) =>
      listing &&
      listing.tradeEnabled &&
      listing.status === "active" &&
      !listing.isHidden
        ? [listing]
        : [],
    ) ?? [];
  const yourChoice = offered || available[0]?.id || "tote";
  const submit = async () => {
    if (!requireUser() || busy) return;
    setBusy(true);
    setError("");
    try {
      const payload =
        kind === "message"
          ? { body }
          : kind === "trade"
            ? { method, offered: yourChoice }
            : { method };
      const { id: session } = await api<{ id: string }>("/practice", "POST", {
        listingId: id,
        kind,
        requestId: startKey.current,
        ...payload,
      });
      go("/practice/" + session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="practice-page">
      <PageTitle
        title={
          kind === "message"
            ? "Message seller"
            : kind === "trade"
              ? "Make a trade offer"
              : "Review order"
        }
        back={"/items/" + id}
      />
      <ItemSummary item={item} />
      <p className="practice-note">{disclosure}</p>
      {!user ? (
        <button className="button" onClick={() => requireUser()}>
          Sign in to continue
        </button>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {kind === "message" ? (
            <label>
              Your message
              <textarea
                required
                maxLength={1000}
                value={body}
                placeholder="Is this still available?"
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          ) : (
            <>
              {kind === "trade" && (
                <>
                  <label>
                    Your offer
                    <select
                      value={yourChoice}
                      onChange={(e) => setOffered(e.target.value)}
                    >
                      {available.length > 0 && (
                        <optgroup label="Your shelf">
                          {available.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.code} · {l.title} · {money(l.priceCents)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Practice shelf">
                        {Object.entries(practiceShelf).map(([key, l]) => (
                          <option key={key} value={key}>
                            {l.code} · {l.title} · {money(l.priceCents)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <small>
                    Your offer uses a copy. Your shelf stays available.
                  </small>
                  {own.error && (
                    <ErrorBox error={own.error} retry={own.reload} />
                  )}
                </>
              )}
              <fieldset className="practice-method">
                <legend>How would you like to get it?</legend>
                {(["shipping", "pickup"] as const).map((m) => (
                  <label key={m}>
                    <input
                      type="radio"
                      name="method"
                      checked={method === m}
                      onChange={() => setMethod(m)}
                    />
                    {m === "shipping" ? (
                      <Truck size={20} />
                    ) : (
                      <MapPin size={20} />
                    )}{" "}
                    {m === "shipping" ? "Shipping" : "Local pickup"}
                  </label>
                ))}
              </fieldset>
              {kind === "purchase" && (
                <div className="practice-total">
                  <span>Simulated total</span>
                  <strong>{money(item.priceCents)}</strong>
                </div>
              )}
            </>
          )}
          {error && <ErrorBox error={error} />}
          <button
            className="button"
            disabled={
              busy ||
              (kind === "message" && !body.trim()) ||
              (kind === "trade" && own.loading)
            }
          >
            {kind === "message"
              ? "Send message"
              : kind === "trade"
                ? "Send trade offer"
                : "Place simulated order"}
          </button>
        </form>
      )}
    </article>
  );
}
type Detail = {
  session: Practice;
  listing: Listing;
  messages: { version: number; body: string; reply: string }[];
};
export function PracticeDetail({ id }: { id: string }) {
  const { user, requireUser } = useApp();
  const record = useResource<Detail>(user ? "/practice/" + id : null);
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const s = record.data?.session;
  if (!user)
    return (
      <button className="button" onClick={() => requireUser()}>
        Sign in to continue
      </button>
    );
  if (record.loading) return <Loading />;
  if (record.error || !s)
    return (
      <ErrorBox
        error={record.error || "Activity unavailable."}
        retry={record.reload}
      />
    );
  async function act(action: string) {
    if (!s || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/practice/" + id, "POST", {
        version: s.version,
        action,
        ...(action === "message" ? { body } : {}),
      });
      if (action === "message") setBody("");
      record.reload();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) record.reload();
    } finally {
      setBusy(false);
    }
  }
  const ship = s.method === "shipping";
  const step: Partial<Record<Practice["state"], [string, string, string]>> = {
    offered: [
      "Your offer is with the seller.",
      "See seller response",
      "seller",
    ],
    countered: [
      "The seller will accept your offered item if you switch to local pickup.",
      "Accept pickup counteroffer",
      "accept",
    ],
    confirmed: ship
      ? [
          "The seller is preparing your package.",
          "Simulate shipment",
          "dispatch",
        ]
      : [
          "The seller is getting your item ready.",
          "Simulate pickup readiness",
          "dispatch",
        ],
    transit: ["Your package is on the way.", "Simulate delivery", "arrive"],
    ready: [
      "The item is ready for your simulated handoff.",
      "Confirm pickup",
      "collect",
    ],
    received: [
      "The package has arrived. Confirm receipt to finish.",
      "Confirm receipt",
      "complete",
    ],
  };
  const next = step[s.state];
  return (
    <article className="practice-page">
      <PageTitle title={kindNames[s.kind]} back={destination[s.kind]} />
      <ItemSummary
        item={{ ...record.data!.listing, priceCents: s.priceCents }}
      />
      <p className="practice-note">{disclosure}</p>
      {s.kind === "message" ? (
        <>
          <div className="practice-chat" aria-label="Message history">
            {record.data?.messages.map((m) => (
              <div key={m.version}>
                <p>
                  <small>You</small>
                  {m.body}
                </p>
                <p>
                  <small>{s.seller} · Automated reply</small>
                  {m.reply}
                </p>
              </div>
            ))}
          </div>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void act("message");
            }}
          >
            <label>
              Your message
              <textarea
                required
                maxLength={1000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button className="button" disabled={busy || !body.trim()}>
              Send message
            </button>
          </form>
          <div className="actions">
            <Link to={practicePath("purchase", s.listingId)}>
              Buy this item
            </Link>
            <Link to={practicePath("trade", s.listingId)}>
              Make a trade offer
            </Link>
          </div>
        </>
      ) : (
        <>
          {s.offer && (
            <div className="practice-total">
              <span>Your offer</span>
              <strong>
                {s.offer.code} · {s.offer.title}
              </strong>
            </div>
          )}
          <div className="practice-total">
            <span>Fulfillment</span>
            <strong>{ship ? "Shipping" : "Local pickup"}</strong>
          </div>
          <section className="practice-status" aria-live="polite">
            {s.state === "complete" ? (
              <Check size={22} />
            ) : (
              <Package size={22} />
            )}
            <div>
              <h2>{stageLabel[s.state]}</h2>
              <p>
                {next?.[0] ||
                  (s.state === "complete"
                    ? "Your simulated exchange is complete."
                    : "This simulated exchange was canceled.")}
              </p>
              {ship &&
                ["transit", "received", "complete"].includes(s.state) && (
                  <small>
                    Practice tracking · BSTY-{s.id.slice(0, 8).toUpperCase()}
                  </small>
                )}
            </div>
          </section>
          {next && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void act(next[2])}
            >
              {next[1]}
            </button>
          )}
          {["confirmed", "offered", "countered"].includes(s.state) && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void act("cancel")}
            >
              {s.state === "countered"
                ? "Decline counteroffer"
                : "Cancel " + kindNames[s.kind].toLowerCase()}
            </button>
          )}
          <Link className="back-link" to={destination[s.kind]}>
            {s.kind === "trade" ? "View trades" : "View orders"}{" "}
            <ArrowRight size={16} />
          </Link>
        </>
      )}
      {error && <ErrorBox error={error} />}
    </article>
  );
}
