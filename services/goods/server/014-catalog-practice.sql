CREATE TABLE catalog_practice (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase','trade','message')),
  state text NOT NULL CHECK (state IN ('conversation','offered','countered','confirmed','transit','ready','received','complete','canceled')),
  method text CHECK (method IN ('shipping','pickup')),
  price_cents integer,
  offer jsonb,
  version integer NOT NULL DEFAULT 1,
  start_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, start_key)
);
CREATE UNIQUE INDEX catalog_practice_open ON catalog_practice(actor_id, listing_id, kind)
WHERE state NOT IN ('complete','canceled');
CREATE INDEX catalog_practice_history ON catalog_practice(actor_id,kind,updated_at DESC);
CREATE TABLE catalog_practice_messages (
  practice_id uuid NOT NULL REFERENCES catalog_practice(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body text NOT NULL,
  reply text NOT NULL,
  PRIMARY KEY(practice_id,version)
);
