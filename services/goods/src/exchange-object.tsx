import { ArrowLeftRight, Check, PackageOpen, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { type Listing, listingPhotoUrl, money } from "./api";

export function ExchangeMark() {
  return (
    <span className="exchange-mark" aria-hidden="true">
      <ArrowLeftRight size={22} strokeWidth={2} />
    </span>
  );
}

export function ExchangeObject({
  item,
  photo,
  selected,
  symbol,
}: {
  item: {
    title: string;
    code: string;
    priceCents: number | null;
    condition?: string;
  };
  photo?: Listing;
  selected?: boolean;
  symbol?: ReactNode;
}) {
  return (
    <span className="exchange-object">
      <span className="exchange-image">
        {photo?.photos[0] ? (
          <img
            alt=""
            src={listingPhotoUrl(photo, photo.photos[0], true)}
            decoding="async"
          />
        ) : (
          <span className="exchange-symbol">
            {symbol || <PackageOpen size={52} strokeWidth={1.4} />}
          </span>
        )}
        <span className="shelf-ticket">Shelf {item.code}</span>
        {selected !== undefined && (
          <span className="exchange-check" aria-hidden="true">
            {selected ? <Check size={17} /> : <Plus size={17} />}
          </span>
        )}
      </span>
      <span className="exchange-caption">
        <strong>{item.title}</strong>
        <b>{item.priceCents === null ? "Unpriced" : money(item.priceCents)}</b>
        {item.condition && <small>{item.condition}</small>}
      </span>
    </span>
  );
}
