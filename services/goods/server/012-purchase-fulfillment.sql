ALTER TABLE listings ADD COLUMN ships_purchases boolean NOT NULL DEFAULT false;

ALTER TABLE purchases
  ADD COLUMN fulfillment text NOT NULL DEFAULT 'pickup'
    CHECK (fulfillment IN ('pickup', 'shipping')),
  ADD COLUMN shipping_address jsonb,
  ADD COLUMN tracker_id text UNIQUE,
  ADD COLUMN carrier text,
  ADD COLUMN tracking_code text,
  ADD COLUMN tracking_status text,
  ADD COLUMN tracking_checked_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN issue_reason text,
  ADD CONSTRAINT purchase_shipping_data CHECK (
    fulfillment = 'shipping' OR (shipping_address IS NULL AND tracker_id IS NULL AND issue_reason IS NULL)
  );

CREATE UNIQUE INDEX purchases_tracking_reference
  ON purchases (lower(carrier), upper(tracking_code)) WHERE tracker_id IS NOT NULL;
