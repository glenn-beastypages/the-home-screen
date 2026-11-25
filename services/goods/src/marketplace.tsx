import { useEffect, useState, type FormEvent } from "react";
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
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Grid2X2,
  MapPin,
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
        Closets for a Cause <span>Meet the concierge <ArrowRight size={14} /></span>
      </Link>
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
      <section
        className="section market-feed"
        aria-labelledby="new-listings-title"
      >
        <div className="section-heading">
          <h2 id="new-listings-title">New listings</h2>
          <Link className="text-button" to="/explore">
            Browse all <ArrowRight size={18} />
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
                <Avatar profile={seller} size={47} />
                <div>
                  <strong>{seller.name}</strong>
                  <span>@{seller.username}</span>
                  <small>{seller.location || "Newly listed goods"}</small>
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
            value={max}
            onChange={(e) => setMax(e.target.value)}
            placeholder="Any"
          />
        </label>
      </div>
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
                  onClick={() => setQ("")}
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
        <Dialog title="Find your thing" onClose={() => setFilterOpen(false)}>
          <form className="form" onSubmit={apply}>
            {fields}
          </form>
        </Dialog>
      )}
    </>
  );
}

export function ItemPage({ id }: { id: string }) {
  const { user, requireUser, go, toast } = useApp();
  const { data, error, loading, reload } = useResource<{ listing: Listing }>(
    "/listings/" + id,
  );
  const [index, setIndex] = useState(0),
    [fullscreen, setFullscreen] = useState(false),
    [trade, setTrade] = useState(
      () => new URLSearchParams(window.location.search).get("offer") === "1",
    ),
    [busy, setBusy] = useState(false);
  const l = data?.listing;
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
    if (!l || !requireUser()) return;
    try {
      await api("/favorites/" + id, "PUT", { saved: !l.isFavorite });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!l) return null;
  const owned = user?.id === l.owner.id;
  const staffed = !l.owner.isDemo;
  const available = !l.isHidden && l.status === "active";
  const reserved = !l.isHidden && l.status === "reserved";
  const canStartConversation = staffed && (available || reserved);
  let touchStart: { x: number; y: number } | null = null;
  const gallery = (
    <div
      className={"gallery " + (fullscreen ? "gallery-fullscreen" : "")}
      onTouchStart={(e) => {
        touchStart =
          e.touches.length === 1
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : null;
      }}
      onTouchEnd={(e) => {
        if (!touchStart || e.touches.length > 0) return;
        const delta = e.changedTouches[0].clientX - touchStart.x;
        const vertical = e.changedTouches[0].clientY - touchStart.y;
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
      <span className="gallery-counter">
        {l.photos.length ? index + 1 : 0} / {l.photos.length}
      </span>
      {!fullscreen && (
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
        <Link className="back-link" to="/explore">
          <ChevronLeft size={18} /> Marketplace
        </Link>
        <div className="actions">
          <button className="text-button" onClick={share}>
            <Share2 size={17} /> Share
          </button>
          <button className="text-button" onClick={save}>
            <Heart size={17} fill={l.isFavorite ? "currentColor" : "none"} />
            {l.isFavorite ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      <div className="item-layout">
        <div className="item-visual">
          {gallery}
          {l.photos.length > 1 && (
            <div className="gallery-thumbs">
              {l.photos.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setIndex(i)}
                  className={i === index ? "selected" : ""}
                  aria-label={"View photo " + (i + 1)}
                >
                  <img src={listingPhotoUrl(l, p, true)} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <section className="item-info">
          <div className="item-kicker">
            <span className="code-pill">{l.code}</span>
            <Status value={l.status} />
          </div>
          <h1>{l.title || "Untitled draft"}</h1>
          <p className="item-subtitle">
            {l.category} <span>·</span> {l.condition}
          </p>
          <div className="item-price">{money(l.priceCents)}</div>
          {!owned && staffed && available && l.priceCents !== null && (
            <p className="muted small-copy">
              {canBuy
                ? checkout.data?.shipping
                  ? "Pay online and choose shipping or local pickup."
                  : "Pay online and arrange local pickup with the seller."
                : l.tradeEnabled
                  ? "Listed value. Message the seller if you’d like to buy."
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
              <p className="muted small-copy">
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
                <Link
                  className="button secondary full"
                  to={practicePath("message", l.id)}
                >
                  <MessageCircle size={19} /> Message seller
                </Link>
              </div>
            </>
          )}
          {isTradeable(l) && (
            <div className="trade-callout">
              <ArrowLeftRight size={19} />
              <div>
                <strong>Open to trade</strong>
                {!owned && (
                  <p>Offer an item from your shelf to start a trade.</p>
                )}
              </div>
            </div>
          )}
          {(owned || canBuy || canStartConversation) && (
            <div
              className={
                owned ? "item-actions" : "item-actions item-actions-transaction"
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
                  <button
                    className={
                      available && !l.tradeEnabled && !canBuy
                        ? "button full"
                        : "button secondary full"
                    }
                    disabled={busy}
                    onClick={message}
                  >
                    {busy ? <Spinner /> : <MessageCircle size={19} />}
                    {isTradeable(l)
                      ? "Message about trading"
                      : "Message seller"}
                  </button>
                </>
              )}
            </div>
          )}
          <Seller profile={l.owner} />
          <div className="item-detail-block">
            <h3>Description</h3>
            <p className="preserve-lines">{l.description}</p>
          </div>
          {isTradeable(l) && l.tradePreferences && (
            <div className="item-detail-block">
              <h3>Open to trading for</h3>
              <p>{l.tradePreferences}</p>
            </div>
          )}
          <div className="item-detail-block item-facts">
            <div>
              <span>Inventory position</span>
              <strong>{l.code}</strong>
            </div>
            <div>
              <span>Condition</span>
              <strong>{l.condition}</strong>
            </div>
            <div>
              <span>Listed</span>
              <strong>{new Date(l.createdAt).toLocaleDateString()}</strong>
            </div>
            <div>
              <span>Item reference</span>
              <small className="monospace">{l.id.slice(0, 12)}</small>
            </div>
          </div>
          <ReportButton targetType="listing" targetId={l.id} />
        </section>
      </div>
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
          <span className="muted">@{p.username}</span>
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
