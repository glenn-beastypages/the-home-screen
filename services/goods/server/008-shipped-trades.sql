ALTER TABLE trade_offers
  ADD COLUMN fulfillment text NOT NULL DEFAULT 'meetup' CHECK (fulfillment IN ('meetup', 'shipping')),
  ADD COLUMN cash_difference_cents integer NOT NULL DEFAULT 0 CHECK (cash_difference_cents >= 0);

CREATE TABLE trade_shipping (
  trade_id uuid PRIMARY KEY REFERENCES trade_offers(id),
  ship_by timestamptz NOT NULL DEFAULT now() + interval '3 days',
  resolution text CHECK (resolution IN ('completed', 'canceled')),
  charge_party text REFERENCES profiles(id),
  charge_cents integer NOT NULL DEFAULT 0 CHECK (charge_cents >= 0),
  settlement_error boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now() - interval '1 day',
  CHECK ((charge_party IS NULL) = (charge_cents = 0))
);
CREATE INDEX trade_shipping_poll ON trade_shipping(checked_at);

CREATE TABLE trade_shipping_parties (
  trade_id uuid NOT NULL REFERENCES trade_shipping(trade_id),
  user_id text NOT NULL REFERENCES profiles(id),
  security_cents integer NOT NULL CHECK (security_cents >= 50),
  cash_cents integer NOT NULL DEFAULT 0 CHECK (cash_cents >= 0),
  address jsonb,
  checkout_key uuid NOT NULL,
  checkout_id text UNIQUE,
  hold_status text NOT NULL DEFAULT 'none' CHECK (hold_status IN ('none', 'checkout', 'authorized', 'too_short', 'expired', 'released', 'captured')),
  hold_until timestamptz,
  captured_cents integer NOT NULL DEFAULT 0 CHECK (captured_cents >= 0),
  quote_id text,
  quote_rates jsonb,
  label_rate text,
  label_url text,
  tracker_id text UNIQUE,
  carrier text,
  tracking_code text,
  tracking_status text,
  PRIMARY KEY (trade_id, user_id)
);
CREATE UNIQUE INDEX unique_trade_tracking_number ON trade_shipping_parties(lower(carrier), upper(tracking_code)) WHERE tracking_code IS NOT NULL;

CREATE TABLE trade_payout_accounts (
  user_id text PRIMARY KEY REFERENCES profiles(id),
  account_id text NOT NULL UNIQUE,
  ready boolean NOT NULL DEFAULT false
);
