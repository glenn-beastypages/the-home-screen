ALTER TABLE listings DROP CONSTRAINT listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('draft','active','reserved','traded','sold','archived','hidden'));

CREATE TABLE purchase_sellers (
  seller_id text PRIMARY KEY REFERENCES profiles(id),
  account_id text NOT NULL UNIQUE,
  ready boolean NOT NULL DEFAULT false
);

CREATE TABLE purchases (
  id uuid PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES profiles(id),
  seller_id text NOT NULL REFERENCES profiles(id),
  listing_id uuid NOT NULL REFERENCES listings(id),
  account_id text NOT NULL REFERENCES purchase_sellers(account_id),
  title text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 50 AND 99999999),
  request_id text NOT NULL,
  session_id text UNIQUE,
  payment_id text UNIQUE,
  refund_id text UNIQUE,
  conversation_id uuid REFERENCES conversations(id),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','canceled','paid','complete','refunding','refunded','refund_failed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id),
  UNIQUE (buyer_id, request_id)
);
CREATE UNIQUE INDEX purchases_listing_lock ON purchases (listing_id)
  WHERE state IN ('pending','paid','complete','refunding','refunded','refund_failed');
CREATE INDEX purchases_buyer_idx ON purchases (buyer_id, created_at DESC);
CREATE INDEX purchases_seller_idx ON purchases (seller_id, created_at DESC);
