/* November 17–19 intake: House of Nanking opens BEASTY • Chinese. Set BASE to verify the public release. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, devices, webkit } from 'playwright'
import { tsImport } from 'tsx/esm/api'
import { freshTestDb } from './pgtest.mjs'
import { navigate } from './live-navigation.mjs'

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const batch = read('research/roster/batch124.json')
const prior = read('research/roster/b86-b123-coverage.json')
const archive = read('research/roster/b86-b124-coverage.json')
const { ALL_PLACEMENTS } = await tsImport('../src/data/categorySeats.ts', import.meta.url)
const { brandById } = await tsImport('../src/data/brands.ts', import.meta.url)
const { REELS } = await tsImport('../src/data/clips.ts', import.meta.url)
const { BEASTY_CATEGORIES } = await tsImport('../src/data/categories.ts', import.meta.url)
const { CATEGORY_GLYPHS } = await tsImport('../src/data/categoryGlyphs.ts', import.meta.url)
const { reviewsBy, reviewsOf, pageOfFoodie } = await tsImport('../src/data/foodieIndex.ts', import.meta.url)

/* Records: every send after Batch 123 is in the ledger, every attachment has a disposition. */
assert.deepEqual(archive.posts, [...prior.posts, ...batch.posts])
assert.equal(batch.previousCutoffRow, 252843)
assert(batch.sourceMessages.every((m) => m.rowId > batch.previousCutoffRow && m.rowId <= batch.cutoffRow))
assert(batch.sourceMessages.filter((m) => !m.fromLeon).every((m) => m.disposition), 'every Glenn send has a disposition')
for (const name of batch.sourceMessages.flatMap((row) => row.attachments))
  assert(batch.artworkDispositions.some((item) => item.source === name), name)

/* Seats: the two hand seats, the new category's automatic fill and the Heavy Hitter move. */
for (const [seat, id] of Object.entries({ ...batch.placements, ...batch.overflowAfter }))
  assert.equal(ALL_PLACEMENTS[seat], id, seat)
const chinese = BEASTY_CATEGORIES.find((c) => c.kind === 'chinese')
assert(chinese && CATEGORY_GLYPHS.chinese, 'BEASTY • Chinese has its page and drawing')
const chineseSeats = Object.keys(ALL_PLACEMENTS).filter((s) => s.startsWith('beasty-chinese-'))
assert.equal(chineseSeats.length, 1 + batch.newCategory.automaticSeats)
assert.equal(ALL_PLACEMENTS['beasty-foodies2-5'], 'b_foodieaemerieedance')
assert.equal(ALL_PLACEMENTS['beasty-foodies2-4'], 'b_foodielatinmami')
assert(!Object.entries(ALL_PLACEMENTS).some(([s, id]) => id === 'b_foodieaemerieedance' && s !== 'beasty-foodies2-5'))

/* Films: one reel each, credited, at most four inline per business. */
for (const post of batch.posts) {
  const reels = REELS.filter((r) => r.href === post.source)
  assert.equal(reels.length, 1, post.code)
  assert.equal(reels[0].src, `/clips/${post.slug}.mp4`, post.code)
  assert.equal(reels[0].credit, post.credit, post.code)
  if (post.brand) assert.equal(reels[0].brandId, post.brand, post.code)
  assert(reviewsBy(post.by).some((review) => review.href === post.source && review.src), post.code)
  if (!post.brand) continue
  const brand = brandById(post.brand)
  const local = [brand.clip, ...(brand.clips ?? []), ...reviewsOf(post.brand)]
  assert(new Set(local.map((clip) => clip?.src).filter(Boolean)).size <= 4, post.brand)
}
const nanking = reviewsOf('b_houseofnankingsf').filter((r) => r.src)
assert.equal(nanking.length, 4, 'House of Nanking plays all four requested films')
assert(!reviewsOf('b_zandypekingduck').some((r) => r.href.includes('/Df3Jf9qosVs/')), 'Z & Y Restaurant is not Z & Y Peking Duck')
assert(!reviewsOf('b_mikiyasantaclara').some((r) => r.href.includes('/Df5Jx-3JZlo/') && r.src), 'Mikiya keeps its four inline films')
for (const [id, icon] of [
  ['b_foodiesinglecatm0m', 'influencer-singlecatm0m-v124'],
  ['b_foodieaemerieedance', 'influencer-aemeriee-dance-v124'],
  ['b_foodiebennyeatsbayarea', 'influencer-bennyeats-bayarea-v124'],
  ['b_houseofnankingsf', 'house-of-nanking-sf-v124'],
]) assert.equal(brandById(id).logo.imageUrl, `/icons/${icon}.webp`, id)

const live = process.env.BASE
const db = live ? null : await freshTestDb('batch124')
const port = live ? 0 : await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})
const instance = live ? null : spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'ignore',
  env: { ...process.env, PORT: String(port), DATABASE_URL: db.url, NODE_ENV: 'development', RESEND_API_KEY: '', LEAD_EMAIL: '' },
})
const base = live || `http://127.0.0.1:${port}`
const iphone = process.env.BROWSER === 'webkit'
const browser = await (iphone ? webkit : chromium).launch(iphone ? {} : { args: ['--mute-audio', '--disable-quic'] })
try {
  if (instance) {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (instance.exitCode !== null) break
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) }).catch(() => null)
      if (response?.ok) {
        ready = true
        break
      }
      await delay(500)
    }
    assert(ready, 'Local BEASTY server did not start')
  }
  const page = await browser.newPage({
    ...(iphone ? devices['iPhone 13'] : {}),
    viewport: { width: 393, height: 852 },
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  async function open(id) {
    await navigate(page, base + '/?b=' + id)
    await page.getByRole('heading', { name: brandById(id).name, exact: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), id)
  }
  async function expand(button) {
    await button.scrollIntoViewIfNeeded()
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
    if (await button.getAttribute('aria-expanded') === 'false') await button.click()
    assert.equal(await button.getAttribute('aria-expanded'), 'true')
  }
  async function play(post, owner, creator = false) {
    const reviews = creator ? reviewsBy(post.by) : reviewsOf(owner)
    const index = reviews.findIndex((review) => review.href === post.source)
    assert(index >= 0, post.code)
    const toggle = page.locator('.foodie-review-head').nth(index)
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    const file = `/clips/${post.slug}.mp4`
    const video = page.locator(`video[src="${file}"]`).first()
    await video.scrollIntoViewIfNeeded()
    await video.evaluate(async (el) => {
      if (!el.muted) throw new Error('Clip opened with sound enabled')
      await el.play()
    })
    await page.waitForFunction((src) => [...document.querySelectorAll('video')].some(
      (el) => el.getAttribute('src') === src && el.currentTime > 0 && el.muted,
    ), file, { timeout: 18000 })
    await video.evaluate((el) => el.pause())
  }

  /* House of Nanking: artwork, address, full menu, a film, and back to its city. */
  const listing = batch.listings[0]
  await open('b_houseofnankingsf')
  await page.locator('.brand-logo-zoom-trigger image[href="/icons/' + listing.icon + '.webp"]').waitFor()
  await page.getByText('919 Kearny', { exact: false }).first().waitFor()
  const count = listing.sections.reduce((n, s) => n + s.items.length, 0)
  await expand(page.getByRole('button', { name: 'Menu · ' + count + ' items', exact: true }))
  assert.equal(await page.locator('.menu-row').count(), count)
  assert.equal(await page.locator('.menu-row-price').filter({ hasText: '$0.00' }).count(), 0)
  for (const section of listing.sections) assert(await page.locator('.menu-row').filter({ hasText: section.items[0][0] }).count() > 0)
  await play(batch.posts.find((p) => p.code === 'DQZ7kAJjEDA'), 'b_houseofnankingsf')
  await page.getByRole('button', { name: 'Go to the San Francisco More goods page', exact: true }).click()
  await page.locator('.brand-body').waitFor({ state: 'hidden' })
  await page.locator('.home-page:not([inert]) .home-grid button').filter({ hasText: brandById('b_houseofnankingsf').label }).first().waitFor()

  /* One film from each kind of placement: inline on an existing page, creator page only, no business. */
  for (const [code, owner, creator] of [
    ['DboLDLIMvja', 'b_mrsramen', false],
    ['Df5Jx-3JZlo', 'b_foodiesinglecatm0m', true],
    ['Df3Jf9qosVs', 'b_foodiebooziebrunch', true],
  ]) {
    await open(owner)
    await play(batch.posts.find((p) => p.code === code), owner, creator)
  }
  if (process.env.ALL_BATCH_CLIPS === '1') {
    for (const post of batch.posts) {
      const inline = post.brand && reviewsOf(post.brand).some((review) => review.href === post.source && review.src)
      const owner = inline ? post.brand : pageOfFoodie(post.by)
      assert(owner, post.code)
      await open(owner)
      await play(post, owner, !inline)
      console.log('ok muted playback', post.code)
    }
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await open('b_houseofnankingsf')
  assert.deepEqual(errors, [])

  const targets = [...batch.updatedIcons, ...batch.posts.flatMap((p) => [
    `/clips/${p.slug}.mp4`, `/clips/${p.slug}-poster.webp`,
  ])]
  if (process.env.SKIP_ASSET_HASHES !== '1') {
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
    let next = 0
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < targets.length) {
        const path = targets[next++]
        const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) })
        assert(response.ok, path)
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(readFileSync('public' + path)), path)
      }
    }))
  }
  console.log(`PASS Batch 124 on ${iphone ? 'iPhone WebKit' : 'Chrome'}: House of Nanking with ${count} menu items, BEASTY • Chinese (${chineseSeats.length} seats), ${batch.posts.length} credited films, ${batch.updatedIcons.length} icons, Heavy Hitter seat, muted playback and phone layout.`)
} finally {
  await browser.close()
  if (instance) {
    if (instance.exitCode === null && instance.signalCode === null) {
      const stopped = new Promise((resolve) => instance.once('exit', resolve))
      instance.kill('SIGTERM')
      await stopped
    }
    await db.drop()
  }
}
