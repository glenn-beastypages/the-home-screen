import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sales from "../dev/facebook-sales/listings.json" with { type: "json" };

export const developmentCatalogKey = "bsty-local-facebook-sales-v1";
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function loadDevelopmentSales(config: NodeJS.ProcessEnv) {
  const directory = config.GOODS_DEV_MARKETPLACE_DIR;
  if (!directory) return;
  if (
    !["test", "development"].includes(config.NODE_ENV || "") ||
    !localHosts.has(new URL(config.DATABASE_URL || "about:blank").hostname) ||
    !localHosts.has(new URL(config.APP_URL || "http://localhost").hostname) ||
    config.S3_BUCKET
  )
    throw new Error(
      "Facebook development fixtures require a local app, database and photo store.",
    );

  // Read and verify the whole snapshot before changing any listings.
  return Promise.all(
    sales.map(async (sale) => {
      const sourceId = new URL(sale.sourceUrl).pathname.split("/")[3];
      if (!/^\d+$/.test(sourceId))
        throw new Error("Invalid Marketplace listing URL.");
      const photo = await readFile(join(directory, sourceId + ".webp"));
      if (createHash("sha256").update(photo).digest("hex") !== sale.photoSha256)
        throw new Error(
          "Development photo does not match the reviewed listing: " +
            sale.sourceUrl,
        );
      return { ...sale, sourceId, photo };
    }),
  );
}
