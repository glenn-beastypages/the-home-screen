ALTER TABLE listings ADD COLUMN catalog_retired boolean NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN catalog_source_url text;
