import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import sales from "./listings.json" with { type: "json" };

const directory = resolve(
  process.env.GOODS_DEV_MARKETPLACE_DIR || "var/facebook-sales",
);
await mkdir(directory, { recursive: true });
const digest = (data) => createHash("sha256").update(data).digest("hex");
const missing = [];
for (const sale of sales) {
  const id = new URL(sale.sourceUrl).pathname.split("/")[3];
  const file = join(directory, id + ".webp");
  try {
    if (digest(await readFile(file)) === sale.photoSha256) continue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  missing.push({ ...sale, file });
}
if (missing.length) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ locale: "en-US" });
  try {
    for (const sale of missing) {
      const page = await context.newPage();
      const temporary = sale.file + "." + randomUUID() + ".tmp";
      try {
        await page.goto(sale.sourceUrl, { waitUntil: "domcontentloaded" });
        const photo = page.locator('img[alt^="Product photo of"]').first();
        await photo.waitFor({ timeout: 12000 });
        const url = await photo.evaluate(async (img) => {
          await img.decode();
          return img.currentSrc;
        });
        const response = await context.request.get(url);
        if (!response.ok())
          throw new Error("Photo download returned HTTP " + response.status());
        const bytes = await sharp(await response.body())
          .rotate()
          .resize({
            width: 1400,
            height: 1400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 86 })
          .toBuffer();
        if (digest(bytes) !== sale.photoSha256)
          throw new Error(
            "The source photo changed. Use the reviewed development photo pack.",
          );
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, sale.file);
      } catch (error) {
        console.error(sale.sourceUrl, error.message);
        process.exitCode = 1;
      } finally {
        await rm(temporary, { force: true });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
if (!process.exitCode)
  console.log(
    sales.length + " verified Marketplace listing photos in " + directory,
  );
