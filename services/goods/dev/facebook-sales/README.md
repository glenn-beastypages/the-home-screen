# Facebook Marketplace development catalog

This snapshot contains 16 Bay Area asking prices and seller-stated conditions collected on November 24, 2026. Each entry links to the Facebook sale that supplied its photo. Titles and descriptions are shortened for BSTY. The four BSTY shelves are simulated and orders use the existing practice checkout.

From the Goods package, run `npm run dev:photos` to cache the reviewed photos under `var/facebook-sales/`, or extract the local photo pack into that directory. The command requires Chrome and the development dependencies. Each image is verified against its snapshot checksum. The images are stored outside the public web bundle. A source can be edited, removed or marked sold after capture.

Start the local Goods API with `NODE_ENV=development` and `GOODS_DEV_MARKETPLACE_DIR=var/facebook-sales`. It uses the regular photo store, gallery, search, trade and checkout paths. Removing that variable and restarting returns to the catalog selected by `GOODS_DEMO_CATALOG`. The local fixture supports loopback database and app URLs with filesystem photo storage.
