# Facebook Marketplace photo catalog

The 16 Bay Area listings use the seller’s asking price and stated condition as of November 24, 2026. Each entry links to its source. BSTY confirmed permission to display all 16 seller photos publicly. BSTY orders, trades and messages for these listings use simulated sellers.

The hosted app selects the reviewed photos with `GOODS_DEMO_CATALOG=1` and `GOODS_CATALOG_EDITION=marketplace`. Full-size WebP files live in `server/catalog-photos/`. Startup verifies their checksums, creates thumbnails in the Goods photo store and reuses the same listing identities on restart. Previously featured items remain accessible to shoppers with saved items or existing activity.

To refresh a local copy from the original Facebook pages, run `npm run dev:photos` from the Goods package with Chrome installed. Downloads are verified under `var/facebook-sales/`. If a seller changes or removes a photo, the reviewed bundled copy is still available. Local development can select its own verified cache with `GOODS_DEV_MARKETPLACE_DIR`.
