CREATE TABLE saved_searches (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES profiles(id),
  filters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, filters)
);

CREATE INDEX favorites_listing_idx ON favorites (listing_id, user_id);
