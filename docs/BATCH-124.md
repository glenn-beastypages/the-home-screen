# Batch 124 — November 17–19 directory intake

The [intake ledger](../research/roster/batch124.json) covers all 96 messages after Batch 123 (row 252843, 6:03 a.m. Pacific on November 17) through Glenn’s 2:01 p.m. message on November 19, with 54 of his sends and 15 attachments. Every send has a disposition there.

- **House of Nanking** is on San Francisco’s More goods (seat 97) and opens the new **BEASTY • Chinese** page in spot 0, as Glenn asked (“BEASTY • Chinese / New Category”). The page has the Kearny Street address, phone, hours, pickup ordering, group and catering notes, and the 55-item lunch and dinner menu from the restaurant’s May 2025 menu. Its icon is the restaurant’s own wordmark. Four films play inline: KQED’s Check, Please! Bay Area segment with Kathy Fang, two @festusfeasts reviews (one with @sherryeatworld) and @hellahansel’s visit. [Hours and location](https://www.houseofnankingsf.com/location/house-of-nanking/) · [Menu](https://www.houseofnankingsf.com/menu/)
- **BEASTY • Chinese** has its own takeout-box drawing and uses the Dim Sum background. The 21 existing restaurants whose type line says Chinese, Cantonese, Sichuan, Shanghainese, Hunan or Peking duck fill spots 1–21 in joining order, one tile per business. Two spots stay open. It is listed in More pages and Search.
- **Other clips.** @_aemeriee.dance’s Mrs. Ramen review and @bennyeats.bayarea’s Funky Elephant review play inline on those pages. @singlecatm0m’s Mikiya Santa Clara review plays on her page and in Watch, because Mikiya already has four inline films. @booziebrunch’s review is of Z & Y Restaurant, which is not on BEASTY. The listed Z & Y Peking Duck is a separate restaurant, so the film plays on her page and in Watch with no business link.
- **Creator icons.** @singlecatm0m, @_aemeriee.dance and @bennyeats.bayarea now use their original Instagram avatars, matched to Glenn’s screenshots. Benny’s old tile had orange corners and a white ring around the same photo.
- **Heavy Hitter.** @_aemeriee.dance moves from More foodies seat 142 to seat 5, after the earlier overflow Heavy Hitters. Seats 5–141 move down one, with nobody removed. The first 24 Influencers and every city and category seat stay in place. Glenn’s Newbie and Heavy Hitter tags stay provenance, not public ratings.

## Already done or not listings

- Blank category tiles (IMG_0846) were fixed in `d08c584`. The B•P button was fixed in `d045e3d`. The Goods header, EAT button and shared sign-in were fixed in `53998e7`. The beasty-pages.vercel.app redesign was saved on November 18.
- Talk only: the GrubBrr food-locker link, the two building videos, the $150 payment and the call requests.

## Held

- **Shared sign-up message and cross-link buttons between BEASTY Pages and BSTY Goods** (November 19, 12:13–12:54 p.m.). This is Goods work, not a listing, and Leon agreed to do it. It is left to the Goods session, because `services/goods` is packaged from `bsty-goods`.
- **BSTY Goods logo idea** (1:41–2:01 p.m.). Leon said he will send mockups first.
- **Vectorizing Calvin’s shirt files.** The files are coming by email and none are in the thread.

## Checks

The seat comparison against origin/main found 23 new seats: House of Nanking’s two seats and 21 automatic Chinese spots. Exactly 138 overflow positions moved and nothing was removed. Apart from the new listing, only the three creators’ icons changed among the 1,397 existing business records. `tools/audit-batch124.mjs` passed locally in Chromium, including muted playback of all eight films, the 55-row menu, the San Francisco More goods return and the 320 px layout. `tools/audit-category-glyphs.mjs` passes with 82 categories.

## Live verification

Render served `69eee01` at 3:23 p.m. Pacific on November 19, with the new entry bundle. The directory and Goods both answered 200. The Batch 124 audit passed on beastypages.com in Chromium, with all eight films played muted, and in iPhone WebKit. In both, House of Nanking’s 55-row menu, San Francisco More goods return, 320 px layout, all 22 Chinese seats, the Heavy Hitter seat and all 20 new icon, clip and poster files matched the release. `tools/live-verify.mjs` passed. No new sends had arrived when this was recorded.

Three older audits fail the same way on a clean, built copy of origin/main from before this batch, so they are not caused by it. `audit-data` still expects three BEASTY dock tiles after EAT came back. `audit-categories` waits for a “BEASTY • Cafe” home button. `audit-foodies` fails on its “reviewed twice” example.

[Live verification record](../research/roster/b124-live-verification.json)
