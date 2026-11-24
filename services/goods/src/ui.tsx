import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Box,
  Check,
  LoaderCircle,
  X,
  AlertCircle,
  ArrowLeft,
  UserRound,
  Heart,
  Flag,
} from "lucide-react";
import {
  api,
  listingPhotoUrl,
  withBase,
  withoutBase,
  type Listing,
  type Profile,
} from "./api";

export const AppContext = createContext<{
  user: Profile | null;
  go: (path: string, replace?: boolean) => void;
  refreshUser: () => Promise<void>;
  toast: (text: string) => void;
  requireUser: (returnTo?: string) => boolean;
}>({
  user: null,
  go: () => {},
  refreshUser: async () => {},
  toast: () => {},
  requireUser: () => false,
});
export const useApp = () => useContext(AppContext);
export function Link({
  to,
  children,
  className = "",
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  const { go } = useApp();
  return (
    <a
      href={withBase(to)}
      className={className}
      onClick={(e) => {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          go(to);
        }
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    if (!path) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    api<T>(path)
      .then((v) => {
        if (current) setData(v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, version]);
  return {
    data,
    setData,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
  };
}
export function Spinner() {
  return <LoaderCircle className="spin" aria-label="Loading" size={20} />;
}
export function Loading({ cards = false }: { cards?: boolean }) {
  return cards ? (
    <div className="product-grid" aria-label="Loading listings">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div />
          <span />
          <span />
        </div>
      ))}
    </div>
  ) : (
    <div className="loading">
      <Spinner /> Loading…
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={19} />
      <span>{error}</span>
      {retry && (
        <button type="button" className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  body,
  action,
  children,
}: {
  title: string;
  body: string;
  action?: { label: string; to: string };
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action && (
        <Link className="button" to={action.to}>
          {action.label}
          <ArrowRight size={17} />
        </Link>
      )}
      {children}
    </div>
  );
}
export function Avatar({
  profile,
  size = 38,
}: {
  profile: Profile;
  size?: number;
}) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" />
      ) : (
        (profile.name || profile.username || "?").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
export function Seller({
  profile,
  small = false,
}: {
  profile: Profile;
  small?: boolean;
}) {
  return (
    <Link
      to={"/sellers/" + profile.id}
      className={"seller " + (small ? "small" : "")}
    >
      <Avatar profile={profile} size={small ? 24 : 44} />
      <span>
        <strong>{profile.name || profile.username}</strong>
        {!small && (
          <small>
            @{profile.username || "member"}
            {profile.location ? " · " + profile.location : ""}
          </small>
        )}
      </span>
      {!small && <ArrowRight size={17} />}
    </Link>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={"status status-" + value}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  children,
  back,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  back?: string;
}) {
  return (
    <div className="page-heading">
      {back && (
        <Link className="back-link" to={back}>
          <ArrowLeft size={17} /> Back
        </Link>
      )}
      <div>
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const modal = document.querySelector('[role="dialog"]');
        const els = Array.from(
          modal?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,textarea,a[href]",
          ) || [],
        );
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", h);
    const first = document.querySelector<HTMLElement>('[role="dialog"] button');
    first?.focus();
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", h);
      focused?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={"modal " + (wide ? "modal-wide " : "") + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Confirm({
  title,
  body,
  onConfirm,
  onClose,
  busy = false,
  label = "Confirm",
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="muted">{body}</p>
      <div className="actions">
        <button className="button secondary" onClick={onClose}>
          Go back
        </button>
        <button className="button" disabled={busy} onClick={onConfirm}>
          {busy ? <Spinner /> : <Check size={17} />} {label}
        </button>
      </div>
    </Dialog>
  );
}
export function Photo({
  listing,
  className = "",
}: {
  listing: Listing;
  className?: string;
}) {
  return (
    <div className={"item-photo " + className}>
      {listing.photos?.[0] ? (
        <img
          src={listingPhotoUrl(listing, listing.photos[0], true)}
          alt={listing.title}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Box size={28} strokeWidth={1} />
      )}
    </div>
  );
}
export function ProductCard({
  listing,
  onSaved,
}: {
  listing: Listing;
  onSaved?: () => void;
}) {
  const { requireUser, toast } = useApp();
  const [saved, setSaved] = useState(listing.isFavorite);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSaved(listing.isFavorite), [listing.isFavorite]);
  const toggle = async () => {
    if (!requireUser()) return;
    setBusy(true);
    try {
      const r = await api<{ saved: boolean }>(
        "/favorites/" + listing.id,
        "PUT",
        { saved: !saved },
      );
      setSaved(r.saved);
      onSaved?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="product-card">
      <div className="product-image">
        <Link to={"/items/" + listing.id}>
          <Photo listing={listing} />
        </Link>
        <button
          className={"favorite " + (saved ? "saved" : "")}
          onClick={toggle}
          disabled={busy}
          aria-label={(saved ? "Unsave " : "Save ") + listing.title}
        >
          <Heart size={18} fill={saved ? "currentColor" : "none"} />
        </button>
        {listing.status !== "active" && (
          <span className="image-status">{listing.status}</span>
        )}
      </div>
      <div className="product-meta">
        <span>{moneyForCard(listing.priceCents)}</span>
        {listing.tradeEnabled && <span className="trade-mark">↔ Trade</span>}
      </div>
      <Link className="product-title" to={"/items/" + listing.id}>
        {listing.title || "Untitled draft"}
      </Link>
      <div className="product-facts">
        {listing.code && (
          <span
            className="shelf-ticket"
            aria-label={"Seller shelf position " + listing.code}
          >
            {listing.code}
          </span>
        )}
        <span className="product-condition">{listing.condition}</span>
        {listing.owner.location && <span>{listing.owner.location}</span>}
      </div>
    </article>
  );
}
const moneyForCard = (c: number | null) =>
  c == null
    ? "Trade only"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: c % 100 ? 2 : 0,
      }).format(c / 100);
export function ProductGrid({
  items,
  onSaved,
}: {
  items: Listing[];
  onSaved?: () => void;
}) {
  return (
    <div className="product-grid catalog-grid">
      {items.map((item) => (
        <ProductCard key={item.id} listing={item} onSaved={onSaved} />
      ))}
    </div>
  );
}
export function ReportButton({
  targetType,
  targetId,
  iconOnly = false,
}: {
  targetType: "listing" | "user" | "message" | "trade";
  targetId: string;
  iconOnly?: boolean;
}) {
  const { requireUser, toast } = useApp();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/reports", "POST", { targetType, targetId, reason });
      setOpen(false);
      toast("Report received. The moderation team can review it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className={iconOnly ? "icon-button" : "text-button subtle"}
        aria-label={iconOnly ? "Report " + targetType : undefined}
        onClick={() => {
          if (requireUser()) setOpen(true);
        }}
      >
        {iconOnly ? <Flag size={15} aria-hidden /> : "Report " + targetType}
      </button>
      {open && (
        <Dialog title="Report a concern" onClose={() => setOpen(false)}>
          <p className="muted">
            Tell us what happened. This report is visible to the moderation
            team.
          </p>
          <label>
            Reason
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={4}
            />
          </label>
          {error && <ErrorBox error={error} />}
          <button
            className="button full"
            disabled={busy || reason.trim().length < 5}
            onClick={send}
          >
            {busy ? <Spinner /> : "Send report"}
          </button>
        </Dialog>
      )}
    </>
  );
}
export function SignedOut({ what = "continue" }: { what?: string }) {
  const next =
    "?returnTo=" +
    encodeURIComponent(withoutBase(location.pathname + location.search));
  return (
    <Empty
      title="Sign in to BSTY Goods"
      body={`Sign in to ${what}.`}
      action={{ label: "Sign in", to: "/login" + next }}
    >
      <Link to={"/signup" + next} className="text-button">
        New here? Create an account
      </Link>
    </Empty>
  );
}
