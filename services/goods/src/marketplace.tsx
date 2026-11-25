import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Search,
  SlidersHorizontal,
  X,
  Heart,
  Share2,
  MoreHorizontal,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Grid2X2,
  MapPin,
  Package,
} from "lucide-react";
import {
  api,
  ApiError,
  startListingConversation,
  conditions,
  money,
  recentlyViewedIds,
  listingPhotoUrl,
  withBase,
  recordViewed,
  clearRecentlyViewed,
  type Listing,
  type Page,
  type Profile,
} from "./api";
import {
  Avatar,
  Dialog,
  Empty,
  ErrorBox,
  Link,
  Loading,
  PageTitle,
  Photo,
  ProductGrid,
  ReportButton,
  Seller,
  SignedOut,
  Spinner,
  Status,
  useApp,
  useResource,
} from "./ui";
import { TradeComposer, isTradeable } from "./trade-offer";
import { practicePath } from "./practice";
import { BuyAction } from "./purchases";
import { shareUrl } from "./platform";

export function Home() {
  const { user } = useApp();
  const { data, error, loading, reload } = useResource<Page<Listing>>(
    "/listings?sort=newest&limit=12",
  );
  const { data: categories } = useResource<{ items: string[] }>("/categories");
  const saved = useResource<Page<Listing>>(user ? "/favorites?limit=4" : null);
  const category = saved.data?.items.find(
    (item) => item.status === "active" && item.category,
  )?.category;
  const related = useResource<Page<Listing>>(
    category
      ? "/listings?category=" + encodeURIComponent(category) + "&limit=8"
      : null,
  );
  const [recent, setRecent] = useState<Listing[]>([]);
  const [recentError, setRecentError] = useState("");
  const [recentVersion, setRecentVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setRecent([]);
    setRecentError("");
    const ids = recentlyViewedIds(user?.id).slice(0, 8);
    if (!ids.length) return;
    void Promise.allSettled(
      ids.map((id) =>
        api<{ listing: Listing }>("/listings/" + encodeURIComponent(id)),
      ),
    ).then((results) => {
      if (!current) return;
      setRecent(
        results.flatMap((result) =>
          result.status === "fulfilled" &&
          result.value.listing.status === "active" &&
          !result.value.listing.isHidden
            ? [result.value.listing]
            : [],
        ),
      );
      if (
        results.some(
          (result) =>
            result.status === "rejected" &&
            ![403, 404].includes(result.reason?.status),
        )
      )
        setRecentError(
          "Your recent finds could not all be refreshed. Please try again.",
        );
    });
    return () => {
      current = false;
    };
  }, [user?.id, recentVersion]);
  const sellers = [
    ...new Map(
      (data?.items || []).map((item) => [item.owner.id, item.owner]),
    ).values(),
  ].slice(0, 4);
  const relatedItems =
    related.data?.items
      .filter(
        (item) =>
          item.status === "active" &&
          !saved.data?.items.some((savedItem) => savedItem.id === item.id),
      )
      .slice(0, 4) || [];
  return (
    <div className="market-home">
      <Link className="closet-announcement" to="/closets-for-a-cause">
        Closets for a Cause{" "}
        <span>
          Meet the concierge <ArrowRight size={14} />
        </span>
      </Link>
      <section className="market-masthead" aria-labelledby="market-title">
        <div className="market-intro">
          <h1
            id="market-title"
            className="market-acronym"
            aria-label="Buy, Sell, Trade Your Goods"
          >
            <span>
              <b>B</b>uy, <b>S</b>ell, <b>T</b>rade
            </span>{" "}
            <span>
              <b>Y</b>our Goods.
            </span>
          </h1>
          <Link to="/explore?tradeOnly=true" className="market-trade-link">
            <ArrowLeftRight size={16} /> Browse tradeable items
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="market-shelf-window">
          <img
            className="market-shelf-photo"
            src={withBase("/brand/market-shelf.webp")}
            alt=""
            fetchPriority="high"
          />
        </div>
      </section>
      <nav className="market-categories" aria-label="Shop by category">
        <Link className="market-all" to="/explore">
          <Grid2X2 size={16} /> All goods
        </Link>
        {categories?.items.map((name) => (
          <Link key={name} to={"/explore?category=" + encodeURIComponent(name)}>
            {name}
          </Link>
        ))}
      </nav>
      <section
        className="section market-feed"
        aria-labelledby="new-listings-title"
      >
        <div className="section-heading">
          <h2 id="new-listings-title">New listings</h2>
          <Link className="text-button" to="/explore">
            Browse all <ArrowUpRight size={18} />
          </Link>
        </div>
        {loading ? (
          <Loading cards />
        ) : error ? (
          <ErrorBox error={error} retry={reload} />
        ) : data?.items.length ? (
          <ProductGrid items={data.items} />
        ) : (
          <Empty
            title="No listings yet"
            body="List an item to start the marketplace."
            action={{ label: "List an item", to: "/sell/new" }}
          />
        )}
      </section>
      <section className="market-resale" aria-labelledby="market-resale-title">
        <div>
          <h2 id="market-resale-title">Managed resale</h2>
          <p>
            Have a collection to sell or a fundraiser to plan? Ask BSTY Goods
            about storage, tagging, and listings.
          </p>
        </div>
        <Link className="button" to="/managed-resale">
          See how it works <ArrowRight size={17} />
        </Link>
      </section>
      {sellers.length > 0 && (
        <section className="section seller-discovery-section">
          <div className="section-heading">
            <div>
              <h2>Browse sellers</h2>
            </div>
          </div>
          <div className="seller-discovery-grid">
            {sellers.map((seller) => (
              <Link
                to={"/sellers/" + seller.id}
                className="seller-discovery-card"
                key={seller.id}
              >
                <div className="seller-stock" aria-hidden="true">
                  {data?.items
                    .filter(
                      (item) =>
                        item.owner.id === seller.id && item.photos.length,
                    )
                    .slice(0, 3)
                    .map((item) => (
                      <img
                        key={item.id}
                        src={listingPhotoUrl(item, item.photos[0], true)}
                        alt=""
                        loading="lazy"
                      />
                    ))}
                </div>
                <Avatar profile={seller} size={36} />
                <div>
                  <strong>{seller.name}</strong>
                  {!seller.isDemo && <span>@{seller.username}</span>}
                  {seller.location && <small>{seller.location}</small>}
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {user && (saved.error || !!saved.data?.items.length) && (
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>Saved goods</h2>
            </div>
            <Link className="text-button" to="/favorites">
              View saved <ArrowRight size={17} />
            </Link>
          </div>
          {saved.error ? (
            <ErrorBox error={saved.error} retry={saved.reload} />
          ) : (
            <ProductGrid
              items={saved.data?.items || []}
              onSaved={saved.reload}
            />
          )}
        </section>
      )}
      {category && (related.error || relatedItems.length > 0) && (
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>More in {category}</h2>
            </div>
            <Link
              className="text-button"
              to={"/explore?category=" + encodeURIComponent(category)}
            >
              Explore <ArrowRight size={17} />
            </Link>
          </div>
          {related.error ? (
            <ErrorBox error={related.error} retry={related.reload} />
          ) : (
            <ProductGrid items={relatedItems} onSaved={saved.reload} />
          )}
        </section>
      )}
      {(recentError || recent.length > 0) && (
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>Recently viewed</h2>
            </div>
            <button
              className="text-button subtle"
              onClick={() => {
                clearRecentlyViewed(user?.id);
                setRecent([]);
                setRecentError("");
              }}
            >
              Clear history
            </button>
          </div>
          {recentError && (
            <ErrorBox
              error={recentError}
              retry={() => setRecentVersion((v) => v + 1)}
            />
          )}
          <ProductGrid items={recent.slice(0, 4)} />
        </section>
      )}
    </div>
  );
}

const savedSearchFields = [
  "q",
  "category",
  "condition",
  "minPrice",
  "maxPrice",
  "tradeOnly",
  "sort",
  "seller",
];
type SavedSearch = {
  id: string;
  filters: Record<string, string | number>;
};

export function SavedSearches() {
  const { user, toast } = useApp();
  const { data, loading, error, reload, setData } = useResource<{
    items: SavedSearch[];
  }>(user ? "/saved-searches" : null);
  const [busy, setBusy] = useState<string | null>(null);
  async function remove(id: string) {
    setBusy(id);
    try {
      await api("/saved-searches/" + id, "DELETE");
      setData(
        (current) =>
          current && { items: current.items.filter((item) => item.id !== id) },
      );
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!user) return <SignedOut what="see your saved searches" />;
  return (
    <>
      <PageTitle title="Saved searches" back="/favorites" />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : data?.items.length ? (
        <ul className="saved-search-list">
          {data.items.map(({ id, filters }) => {
            const label = [
              filters.q,
              filters.category,
              filters.condition,
              filters.tradeOnly === "true" ? "Open to trade" : "",
              filters.minPrice !== undefined
                ? "From " + money(Number(filters.minPrice))
                : "",
              filters.maxPrice !== undefined
                ? "Up to " + money(Number(filters.maxPrice))
                : "",
              filters.seller ? "Specific seller" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            const url = new URLSearchParams(
              Object.entries(filters).map(([key, value]) => [
                key,
                String(value),
              ]),
            );
            return (
              <li key={id} className="panel">
                <Link to={"/explore?" + url}>
                  <strong>{label}</strong>
                </Link>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy !== null}
                  aria-label={"Remove " + label}
                  onClick={() => void remove(id)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          title="No saved searches"
          body="Run a search or apply filters, then save it to come back to the results."
          action={{ label: "Explore goods", to: "/explore" }}
        />
      )}
    </>
  );
}

export function Explore({ favorites = false }: { favorites?: boolean }) {
  const { user, go, requireUser, toast } = useApp();
  const search = new URLSearchParams(location.search);
  const [q, setQ] = useState(search.get("q") || "");
  const [category, setCategory] = useState(search.get("category") || "");
  const [condition, setCondition] = useState(search.get("condition") || "");
  const [tradeOnly, setTradeOnly] = useState(
    search.get("tradeOnly") === "true",
  );
  const [min, setMin] = useState(
    search.get("minPrice") ? String(Number(search.get("minPrice")) / 100) : "",
  );
  const [max, setMax] = useState(
    search.get("maxPrice") ? String(Number(search.get("maxPrice")) / 100) : "",
  );
  const [sort, setSort] = useState(search.get("sort") || "newest");
  const [filterOpen, setFilterOpen] = useState(false);
  const badRange = min !== "" && max !== "" && Number(min) > Number(max);
  const [items, setItems] = useState<Listing[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [version, setVersion] = useState(0);
  const [savingSearch, setSavingSearch] = useState(false);
  const [searchSaved, setSearchSaved] = useState(false);
  const { data: categories } = useResource<{ items: string[] }>("/categories");
  const params = new URLSearchParams(location.search);
  params.set("limit", "24");
  const path = favorites ? "/favorites?limit=24" : "/listings?" + params;
  const filtersToSave = Object.fromEntries(
    Array.from(search).filter(([key]) => savedSearchFields.includes(key)),
  );
  const canSaveSearch = Object.entries(filtersToSave).some(
    ([key, value]) =>
      value.trim() &&
      key !== "sort" &&
      (key !== "tradeOnly" || value === "true"),
  );
  async function saveSearch() {
    if (!requireUser() || savingSearch) return;
    setSavingSearch(true);
    try {
      await api("/saved-searches", "POST", filtersToSave);
      setSearchSaved(true);
      toast("Search saved");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setSavingSearch(false);
    }
  }
  useEffect(() => {
    let current = true;
    if (favorites && !user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api<Page<Listing>>(path)
      .then((d) => {
        if (current) {
          setItems(d.items);
          setNext(d.nextCursor);
        }
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
  }, [path, user?.id, version]);
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    if (badRange) {
      setFilterOpen(window.matchMedia("(max-width: 700px)").matches);
      return;
    }
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (condition) p.set("condition", condition);
    if (tradeOnly) p.set("tradeOnly", "true");
    if (min) p.set("minPrice", String(Math.round(Number(min) * 100)));
    if (max) p.set("maxPrice", String(Math.round(Number(max) * 100)));
    p.set("sort", sort);
    setFilterOpen(false);
    go("/explore?" + p);
  };
  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try {
      const separator = path.includes("?") ? "&" : "?";
      const d = await api<Page<Listing>>(
        path + separator + "cursor=" + encodeURIComponent(next),
      );
      setItems((v) => [
        ...v,
        ...d.items.filter((i) => !v.some((old) => old.id === i.id)),
      ]);
      setNext(d.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMore(false);
    }
  };
  const reset = () => {
    setQ("");
    setCategory("");
    setCondition("");
    setTradeOnly(false);
    setMin("");
    setMax("");
    setSort("newest");
    setFilterOpen(false);
    go("/explore");
  };
  if (favorites && !user) return <SignedOut what="save your favorite finds" />;
  const fields = (
    <>
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories?.items.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Condition
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          <option value="">Any condition</option>
          {conditions.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label>
          Min price ($)
          <input
            type="number"
            min="0"
            step="0.01"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          Max price ($)
          <input
            type="number"
            min="0"
            step="0.01"
            aria-invalid={badRange || undefined}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder="Any"
          />
        </label>
      </div>
      {badRange && (
        <p role="alert" className="form-error">
          Maximum price must be at least the minimum price.
        </p>
      )}
      <label>
        Sort by
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Recently listed</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={tradeOnly}
          onChange={(e) => setTradeOnly(e.target.checked)}
        />{" "}
        Open to trade
      </label>
      <button className="button full" type="submit">
        Show results <ArrowRight size={16} />
      </button>
      <button className="text-button full" type="button" onClick={reset}>
        Reset filters
      </button>
    </>
  );
  return (
    <>
      <PageTitle title={favorites ? "Saved goods" : "Browse the market"}>
        {favorites && (
          <Link className="button secondary" to="/saved-searches">
            Saved searches
          </Link>
        )}
        {!favorites && (
          <button
            className="button secondary mobile-filter"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal size={17} /> Filters
          </button>
        )}
      </PageTitle>
      <div className={favorites ? "" : "explore-layout"}>
        {!favorites && (
          <form className="filters" onSubmit={apply}>
            <div className="filter-heading">
              <SlidersHorizontal size={17} />
              <strong>Filter listings</strong>
            </div>
            {fields}
          </form>
        )}
        <section className="explore-results">
          {!favorites && (
            <form className="search-bar" onSubmit={apply}>
              <Search size={19} />
              <input
                aria-label="Search listings"
                placeholder="Search listings"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQ("");
                    if (search.has("q")) {
                      const remaining = new URLSearchParams(search);
                      remaining.delete("q");
                      remaining.delete("cursor");
                      go("/explore" + (remaining.size ? "?" + remaining : ""));
                    }
                  }}
                >
                  <X size={17} />
                </button>
              )}
              <button className="button compact" type="submit">
                Search
              </button>
            </form>
          )}
          {loading ? (
            <Loading cards />
          ) : error && !items.length ? (
            <ErrorBox error={error} retry={() => setVersion((v) => v + 1)} />
          ) : (
            <>
              {error && (
                <ErrorBox
                  error={error}
                  retry={() => setVersion((v) => v + 1)}
                />
              )}
              <div className="search-result-tools">
                <p className="result-summary">
                  {items.length} {items.length === 1 ? "find" : "finds"}
                  {next ? " and more" : ""}
                  {search.get("q") ? " for “" + search.get("q") + "”" : ""}
                </p>
                {!favorites &&
                  !error &&
                  canSaveSearch &&
                  (searchSaved ? (
                    <Link className="text-button" to="/saved-searches">
                      Search saved · View saved searches
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="button secondary compact"
                      disabled={savingSearch}
                      onClick={() => void saveSearch()}
                    >
                      Save search
                    </button>
                  ))}
              </div>
              {items.length ? (
                <ProductGrid
                  items={items}
                  onSaved={
                    favorites ? () => setVersion((v) => v + 1) : undefined
                  }
                />
              ) : (
                <Empty
                  title={
                    favorites
                      ? "No saved items"
                      : tradeOnly
                        ? "No tradeable items found"
                        : "No listings found"
                  }
                  body={favorites ? "Save an item to find it here later." : ""}
                  action={
                    favorites
                      ? { label: "Explore goods", to: "/explore" }
                      : tradeOnly &&
                          !search.get("q") &&
                          !category &&
                          !condition &&
                          !min &&
                          !max
                        ? {
                            label: "List an item",
                            to: user
                              ? "/sell/new"
                              : "/signup?returnTo=%2Fsell%2Fnew",
                          }
                        : undefined
                  }
                >
                  {!favorites && (
                    <button className="button secondary" onClick={reset}>
                      {tradeOnly ? "Browse all goods" : "Reset filters"}
                    </button>
                  )}
                </Empty>
              )}
              {next && (
                <div className="load-more">
                  <button
                    className="button secondary"
                    disabled={more}
                    onClick={loadMore}
                  >
                    {more ? <Spinner /> : <ArrowDown size={17} />} Load more
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {filterOpen && (
        <Dialog title="Filter listings" onClose={() => setFilterOpen(false)}>
          <form className="form" onSubmit={apply}>
            {fields}
          </form>
        </Dialog>
      )}
    </>
  );
}

function ListingOptions({
  id,
  share,
}: {
  id: string;
  share: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !region.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      ref={region}
      className="listing-options"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="More listing actions"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={20} />
      </button>
      <div
        id={menuId}
        className="listing-options-panel"
        hidden={!open}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.currentTarget.contains(event.target) &&
            event.target.closest("button")
          )
            close();
        }}
      >
        <button className="text-button" onClick={share}>
          <Share2 size={15} /> Share listing
        </button>
        <ReportButton targetType="listing" targetId={id} />
      </div>
    </div>
  );
}
export function ItemPage({ id }: { id: string }) {
  const { user, requireUser, go, toast } = useApp();
  const { data, setData, error, errorStatus, loading, reload } = useResource<{
    listing: Listing;
  }>("/listings/" + id);
  const [index, setIndex] = useState(0),
    [fullscreen, setFullscreen] = useState(false),
    [trade, setTrade] = useState(
      () => new URLSearchParams(window.location.search).get("offer") === "1",
    ),
    [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const l = data?.listing;
  const shelf = useResource<Page<Listing>>(
    l && !l.isHidden && ["active", "reserved"].includes(l.status)
      ? "/listings?seller=" + encodeURIComponent(l.owner.id) + "&limit=5"
      : null,
  );
  const moreFromSeller =
    shelf.data?.items
      .filter((item) => item.id !== id && item.status === "active")
      .slice(0, 4) ?? [];
  const checkoutEligible =
    l?.status === "active" &&
    !l.isHidden &&
    !l.owner.isDemo &&
    !l.tradeEnabled &&
    l.priceCents !== null &&
    user?.id !== l.owner.id;
  const checkout = useResource<{ available: boolean; shipping?: boolean }>(
    checkoutEligible ? "/purchases/options/" + id : null,
  );
  const checkingPurchase = checkoutEligible && !checkout.data;
  const canBuy = checkoutEligible && checkout.data?.available;
  useEffect(() => {
    if (l && ["active", "reserved"].includes(l.status) && !l.isHidden)
      recordViewed(l.id, user?.id);
  }, [l?.id, user?.id]);
  useEffect(() => {
    setIndex(0);
    setTrade(new URLSearchParams(window.location.search).get("offer") === "1");
  }, [id]);
  const message = async () => {
    if (!l || l.owner.isDemo) return;
    const wantsTrade = isTradeable(l);
    if (!requireUser()) return;
    setBusy(true);
    try {
      go(
        (await startListingConversation(l)) +
          (wantsTrade ? "?tradeInterest=1" : ""),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) reload();
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const count = l?.photos.length ?? 0;
    if (!fullscreen || count < 2) return;
    const changePhoto = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setIndex((current) =>
        Math.min(
          count - 1,
          Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)),
        ),
      );
    };
    document.addEventListener("keydown", changePhoto);
    return () => document.removeEventListener("keydown", changePhoto);
  }, [fullscreen, l?.photos.length]);
  const share = async () => {
    try {
      const result = await shareUrl(location.href, l?.title || "BSTY Goods");
      if (result === "copied") toast("Listing link copied.");
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        toast("Copy this page address to share the item.");
    }
  };
  const save = async () => {
    if (!l || saving || !requireUser()) return;
    setSaving(true);
    try {
      const { saved } = await api<{ saved: boolean }>(
        "/favorites/" + id,
        "PUT",
        { saved: !l.isFavorite },
      );
      setData(
        (current) =>
          current && { listing: { ...current.listing, isFavorite: saved } },
      );
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <Loading />;
  if (errorStatus === 404)
    return (
      <Empty
        title="Listing unavailable"
        body="This link no longer opens a public listing."
        action={{ label: "Browse all goods", to: "/explore" }}
      />
    );
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!l) return null;
  const owned = user?.id === l.owner.id;
  const staffed = !l.owner.isDemo;
  const available = !l.isHidden && l.status === "active";
  const reserved = !l.isHidden && l.status === "reserved";
  const canStartConversation = staffed && (available || reserved);
  const messageFirst =
    canStartConversation &&
    !canBuy &&
    !checkingPurchase &&
    !(available && l.tradeEnabled);
  const demoMessage = !staffed && l.isDemo && available;
  const gallery = (
    <div
      className={"gallery " + (fullscreen ? "gallery-fullscreen" : "")}
      onTouchStart={(e) => {
        touchStart.current =
          e.touches.length === 1
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || e.touches.length > 0) return;
        const delta = e.changedTouches[0].clientX - start.x;
        const vertical = e.changedTouches[0].clientY - start.y;
        if (Math.abs(delta) > 45 && Math.abs(delta) > Math.abs(vertical))
          setIndex((i) =>
            Math.max(
              0,
              Math.min(l.photos.length - 1, i + (delta < 0 ? 1 : -1)),
            ),
          );
      }}
    >
      {l.photos[index] ? (
        <img
          className="gallery-main"
          src={listingPhotoUrl(l, l.photos[index])}
          alt={l.title + " — photo " + (index + 1)}
          onClick={() => !fullscreen && setFullscreen(true)}
        />
      ) : (
        <Photo listing={l} />
      )}
      {!fullscreen && l.code && (
        <span className="gallery-ticket shelf-ticket">Shelf {l.code}</span>
      )}
      {l.photos.length > 1 && (
        <span className="gallery-counter" aria-live="polite">
          {index + 1} / {l.photos.length}
        </span>
      )}
      {!fullscreen && !!l.photos.length && (
        <button
          className="gallery-expand icon-button"
          onClick={() => setFullscreen(true)}
          aria-label="View full size photos"
        >
          <Maximize2 size={18} />
        </button>
      )}
      {index > 0 && (
        <button
          className="gallery-prev icon-button"
          aria-label="Previous photo"
          onClick={() => setIndex((i) => i - 1)}
        >
          <ChevronLeft />
        </button>
      )}
      {index < l.photos.length - 1 && (
        <button
          className="gallery-next icon-button"
          aria-label="Next photo"
          onClick={() => setIndex((i) => i + 1)}
        >
          <ChevronRight />
        </button>
      )}
    </div>
  );
  return (
    <>
      <div className="item-topline">
        <nav className="listing-path" aria-label="Breadcrumb">
          <Link to="/explore">Marketplace</Link>
          {l.category && (
            <>
              <ChevronRight aria-hidden="true" size={13} />
              <Link to={"/explore?category=" + encodeURIComponent(l.category)}>
                {l.category}
              </Link>
            </>
          )}
          <ChevronRight aria-hidden="true" size={13} />
          <span aria-current="page">{l.title || "Untitled draft"}</span>
        </nav>
        <ListingOptions id={l.id} share={share} />
      </div>
      <div className="item-layout">
        <div className="item-visual">
          <div className="listing-gallery" aria-label="Listing gallery">
            {gallery}
            {l.photos.length > 1 && (
              <div
                className="gallery-thumbs"
                role="group"
                aria-label="Choose a photo"
              >
                {l.photos.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => setIndex(i)}
                    className={i === index ? "selected" : ""}
                    aria-pressed={i === index}
                    aria-label={"View photo " + (i + 1)}
                  >
                    <img src={listingPhotoUrl(l, p, true)} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="listing-seller">
            <Seller profile={l.owner} />
            {!owned &&
              (demoMessage ? (
                <Link
                  className="seller-message"
                  to={practicePath("message", l.id)}
                >
                  <MessageCircle size={16} /> Message seller
                </Link>
              ) : canStartConversation && !messageFirst ? (
                <button
                  className="seller-message"
                  onClick={message}
                  disabled={busy}
                >
                  {busy ? <Spinner /> : <MessageCircle size={16} />}{" "}
                  {isTradeable(l) ? "Message about trading" : "Message seller"}
                </button>
              ) : null)}
          </div>
        </div>
        <section className="item-info" aria-labelledby="listing-title">
          <div className="buy-summary">
            <div className="listing-title-row">
              <h1 id="listing-title">{l.title || "Untitled draft"}</h1>
              <button
                className="listing-save icon-button"
                aria-label={l.isFavorite ? "Saved" : "Save"}
                title={l.isFavorite ? "Saved" : "Save listing"}
                aria-pressed={l.isFavorite}
                disabled={saving}
                onClick={save}
              >
                <Heart
                  size={20}
                  fill={l.isFavorite ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div className="listing-condition">
              {[l.condition, l.category].filter(Boolean).join(" · ")}
              {!available && (
                <Status value={l.isHidden ? "hidden" : l.status} />
              )}
            </div>
            <div className="item-price">
              {money(l.priceCents)}
              {l.priceCents !== null && staffed && l.tradeEnabled && (
                <small>Listed value</small>
              )}
            </div>
            {checkingPurchase &&
              (checkout.error ? (
                <ErrorBox error={checkout.error} retry={checkout.reload} />
              ) : (
                <p className="muted small-copy" role="status">
                  Checking checkout availability…
                </p>
              ))}
            {!owned &&
              staffed &&
              available &&
              !checkingPurchase &&
              l.priceCents !== null && (
                <p className="muted small-copy">
                  {canBuy
                    ? checkout.data?.shipping
                      ? "Pay online and choose shipping or local pickup."
                      : "Pay online and arrange local pickup with the seller."
                    : l.tradeEnabled
                      ? "Message the seller if you’d like to buy."
                      : "Arrange the purchase directly with the seller."}
                </p>
              )}
            {!owned && !available && (
              <p className="muted small-copy">
                {reserved
                  ? "This item is currently reserved."
                  : "This item is no longer available."}
              </p>
            )}
            {!staffed && l.isDemo && available && (
              <>
                <p className="muted small-copy listing-delivery">
                  <Package size={17} aria-hidden="true" />
                  Simulated seller · Shipping or local pickup. No payment
                  required.
                </p>
                <div className="item-actions item-actions-transaction">
                  {l.priceCents !== null && (
                    <Link
                      className="button full"
                      to={practicePath("purchase", l.id)}
                    >
                      Buy for {money(l.priceCents)}
                    </Link>
                  )}
                  <Link
                    className="button secondary full"
                    to={practicePath("trade", l.id)}
                  >
                    <ArrowLeftRight size={19} /> Make a trade offer
                  </Link>
                </div>
              </>
            )}
            {owned && isTradeable(l) && (
              <div className="trade-callout">
                <ArrowLeftRight size={19} />
                <div>
                  <strong>Open to trade</strong>
                </div>
              </div>
            )}
            {(owned || canBuy || canStartConversation) && (
              <div
                className={
                  owned
                    ? "item-actions"
                    : "item-actions item-actions-transaction"
                }
              >
                {canBuy && (
                  <BuyAction
                    listing={l}
                    shipping={Boolean(checkout.data?.shipping)}
                  />
                )}
                {owned ? (
                  <Link className="button full" to={"/sell/" + l.id}>
                    Manage this listing
                  </Link>
                ) : (
                  <>
                    {l.tradeEnabled && available && (
                      <button
                        className={
                          canBuy ? "button secondary full" : "button full"
                        }
                        onClick={() => {
                          if (requireUser("/items/" + l.id + "?offer=1"))
                            setTrade(true);
                        }}
                      >
                        <ArrowLeftRight size={19} /> Make a trade offer
                      </button>
                    )}
                    {messageFirst && (
                      <button
                        className="button full"
                        disabled={busy}
                        onClick={message}
                      >
                        {busy ? <Spinner /> : <MessageCircle size={18} />}{" "}
                        Message seller
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="listing-details">
            {l.description && (
              <section className="item-detail-block">
                <h2>Description</h2>
                <p className="preserve-lines">{l.description}</p>
              </section>
            )}
            {isTradeable(l) && l.tradePreferences && (
              <section className="item-detail-block">
                <h2>Open to trading for</h2>
                <p>{l.tradePreferences}</p>
              </section>
            )}
            <section className="item-detail-block">
              <h2>Item details</h2>
              <dl className="listing-specs">
                <dt>Shelf position</dt>
                <dd>{l.code}</dd>
                <dt>Listed</dt>
                <dd>
                  {new Date(l.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </dd>
                {l.sourceUrl && (
                  <>
                    <dt>Source</dt>
                    <dd>
                      <a
                        href={l.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Original Facebook Marketplace listing{" "}
                        <ArrowUpRight size={14} />
                      </a>
                    </dd>
                  </>
                )}
                <dt>Item reference</dt>
                <dd>{l.id.slice(0, 12)}</dd>
              </dl>
            </section>
          </div>
        </section>
      </div>
      {moreFromSeller.length > 0 && (
        <section className="section related-shelf">
          <div className="section-heading">
            <h2>More from this shelf</h2>
            <Link className="text-button" to={"/sellers/" + l.owner.id}>
              View shelf <ArrowUpRight size={16} />
            </Link>
          </div>
          <ProductGrid items={moreFromSeller} />
        </section>
      )}
      {fullscreen && (
        <Dialog
          title="Listing photos"
          onClose={() => setFullscreen(false)}
          wide
        >
          {gallery}
          <p className="muted small-copy">
            Pinch to zoom on supported devices.
          </p>
        </Dialog>
      )}
      {trade && user && !owned && isTradeable(l) && (
        <TradeComposer target={l} onClose={() => setTrade(false)} />
      )}
    </>
  );
}

export function SellerPage({ id }: { id: string }) {
  const { user, toast, requireUser } = useApp();
  const { data, setData, error, loading, reload } = useResource<{
    seller: Profile;
    blockedByViewer: boolean;
  }>("/sellers/" + id);
  const {
    data: feed,
    loading: feedLoading,
    error: feedError,
  } = useResource<Page<Listing>>("/listings?seller=" + id + "&limit=78");
  const [blocking, setBlocking] = useState(false);
  const [trade, setTrade] = useState(
    () => new URLSearchParams(location.search).get("offer") === "1",
  );
  const toggleBlock = async () => {
    if (!requireUser() || !data) return;
    setBlocking(true);
    try {
      const blocked = !data.blockedByViewer;
      await api("/blocks", "POST", { userId: id, blocked });
      setData({ ...data, blockedByViewer: blocked });
      toast(blocked ? "User blocked." : "User unblocked.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBlocking(false);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const shelf = [...(feed?.items || [])].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  const occupiedRows = [...new Set(shelf.map((item) => item.code[0]))];
  const p = data?.seller;
  if (!p) return null;
  return (
    <>
      <section className="seller-profile">
        <Avatar profile={p} size={96} />
        <div>
          <span className="eyebrow">The seller’s shelf</span>
          <h1>{p.name}</h1>
          {!p.isDemo && <span className="muted">@{p.username}</span>}
          {p.bio && <p>{p.bio}</p>}
          <div className="profile-facts">
            {p.location && (
              <span>
                <MapPin size={14} />
                {p.location}
              </span>
            )}
            {!p.isDemo && (
              <span>
                Member since{" "}
                {new Date(p.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
            {!p.isDemo && (
              <span>{p.completedTrades || 0} completed trades</span>
            )}
          </div>
        </div>
        {user?.id !== id && (
          <div className="seller-controls">
            <button
              className="text-button"
              onClick={toggleBlock}
              disabled={blocking}
            >
              {data.blockedByViewer ? "Unblock user" : "Block user"}
            </button>
            <ReportButton targetType="user" targetId={id} />
          </div>
        )}
      </section>
      <div className="section-heading">
        <div>
          <h2>On the shelf</h2>
        </div>
        {p.isDemo &&
          !data.blockedByViewer &&
          shelf.some((l) => l.isDemo && l.status === "active") && (
            <button className="button compact" onClick={() => setTrade(!trade)}>
              <ArrowLeftRight size={17} />{" "}
              {trade ? "Done choosing" : "Trade from this shelf"}
            </button>
          )}
        {!p.isDemo &&
          !data.blockedByViewer &&
          user?.id !== id &&
          feed?.items.some(isTradeable) && (
            <button
              className="button compact"
              onClick={() => {
                if (requireUser("/sellers/" + id + "?offer=1")) setTrade(true);
              }}
            >
              <ArrowLeftRight size={17} /> Trade from this shelf
            </button>
          )}
      </div>
      {trade && p.isDemo && !data.blockedByViewer && (
        <p>Choose the item you want to trade for.</p>
      )}
      {feedLoading ? (
        <Loading cards />
      ) : feedError ? (
        <ErrorBox error={feedError} />
      ) : feed?.items.length ? (
        <div className="public-shelf">
          {shelf.map((l) => (
            <Link
              to={
                trade &&
                p.isDemo &&
                l.isDemo &&
                l.status === "active" &&
                !data.blockedByViewer
                  ? practicePath("trade", l.id)
                  : "/items/" + l.id
              }
              className="shelf-item"
              key={l.id}
              style={{
                gridColumn: l.code.split("-")[1],
                gridRow: occupiedRows.indexOf(l.code[0]) + 1,
              }}
            >
              <Photo listing={l} />
              <span className="shelf-code">{l.code}</span>
              <h3>{l.title}</h3>
              <div className="product-meta">
                <span>{money(l.priceCents)}</span>
                <Status value={l.status} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No public listings yet"
          body=""
          action={{ label: "Explore the marketplace", to: "/explore" }}
        />
      )}
      {trade &&
        user &&
        user.id !== id &&
        !p.isDemo &&
        !data.blockedByViewer && (
          <TradeComposer other={p} onClose={() => setTrade(false)} />
        )}
    </>
  );
}
