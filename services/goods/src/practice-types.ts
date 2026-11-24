export type PracticeKind = "purchase" | "trade" | "message";
export type Method = "shipping" | "pickup";
export type Stage =
  | "conversation"
  | "offered"
  | "countered"
  | "confirmed"
  | "transit"
  | "ready"
  | "received"
  | "complete"
  | "canceled";
export type OfferItem = {
  code: string;
  title: string;
  priceCents: number | null;
};
export const practiceShelf: Record<string, OfferItem> = {
  tote: { code: "A-1", title: "Canvas market tote", priceCents: 1800 },
  speaker: { code: "B-2", title: "Portable speaker", priceCents: 6000 },
};
export interface Practice {
  id: string;
  listingId: string;
  title: string;
  code: string;
  seller: string;
  kind: PracticeKind;
  state: Stage;
  method: Method | null;
  priceCents: number | null;
  offer: OfferItem | null;
  version: number;
}
export const stageLabel: Record<Stage, string> = {
  conversation: "Conversation",
  offered: "Offer sent",
  countered: "Pickup counteroffer",
  confirmed: "Confirmed",
  transit: "In transit",
  ready: "Ready for pickup",
  received: "Delivered",
  complete: "Completed",
  canceled: "Canceled",
};
