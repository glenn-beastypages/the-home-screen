ALTER TABLE trade_offers
  ADD COLUMN offered_bundle jsonb,
  ADD COLUMN requested_bundle jsonb,
  ADD COLUMN item_ids uuid[],
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN proposed_by text REFERENCES profiles(id),
  ADD COLUMN plan_required boolean NOT NULL DEFAULT false,
  ADD COLUMN exchange_plan jsonb,
  ADD COLUMN shipments jsonb NOT NULL DEFAULT '{}';

UPDATE trade_offers
SET offered_bundle = jsonb_build_array(offered_snapshot),
    requested_bundle = jsonb_build_array(requested_snapshot),
    item_ids = ARRAY[offered_id, requested_id],
    proposed_by = sender_id;

ALTER TABLE trade_offers
  ALTER COLUMN offered_bundle SET NOT NULL,
  ALTER COLUMN requested_bundle SET NOT NULL,
  ALTER COLUMN item_ids SET NOT NULL,
  ALTER COLUMN proposed_by SET NOT NULL,
  ADD CHECK (proposed_by IN (sender_id, recipient_id)),
  ADD CHECK (jsonb_array_length(offered_bundle) BETWEEN 1 AND 10),
  ADD CHECK (jsonb_array_length(requested_bundle) BETWEEN 1 AND 10),
  ADD CHECK (cardinality(item_ids) = jsonb_array_length(offered_bundle) + jsonb_array_length(requested_bundle)),
  DROP CONSTRAINT trade_offers_fulfillment_check,
  ADD CHECK (fulfillment IN ('meetup', 'shipping', 'arranged_shipping'));

CREATE INDEX trade_offer_items_idx ON trade_offers USING gin(item_ids);
ALTER TABLE trade_events ADD COLUMN proposal jsonb;
