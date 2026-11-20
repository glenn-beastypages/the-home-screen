/* November 19 intake: Little Lucca, Minnie Bell’s opens BEASTY • Soul Food, 18 credited films. Set BASE to verify the public release. */
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
const batch = read('research/roster/batch125.json')
const prior = read('research/roster/b86-b124-coverage.json')
const archive = read('research/roster/b86-b125-coverage.json')
const { ALL_PLACEMENTS } = await tsImport('../src/data/categorySeats.ts', import.meta.url)
const { brandById } = await tsImport('../src/data/brands.ts', import.meta.url)
const { REELS } = await tsImport('../src/data/clips.ts', import.meta.url)
const { BEASTY_CATEGORIES } = await tsImport('../src/data/categories.ts', import.meta.url)
const { CATEGORY_GLYPHS } = await tsImport('../src/data/categoryGlyphs.ts', import.meta.url)
const { CATEGORY_OVERFLOW } = await tsImport('../src/data/slots.ts', import.meta.url)
const { reviewsBy, reviewsOf, pageOfFoodie } = await tsImport('../src/data/foodieIndex.ts', import.meta.url)

/* Records: every send after Batch 124 is in the ledger, every attachment has a disposition. */
assert.deepEqual(archive.posts, [...prior.posts, ...batch.posts])
assert.equal(batch.previousCutoffRow, 253051)
assert(batch.sourceMessages.every((m) => m.rowId > batch.previousCutoffRow && m.rowId <= batch.cutoffRow))
assert(batch.sourceMessages.filter((m) => !m.fromLeon).every((m) => m.disposition), 'every Glenn send has a disposition')
for (const name of batch.sourceMessages.flatMap((row) => row.attachments))
  assert(batch.artworkDispositions.some((item) => item.source === name), name)

/* Seats: the four hand seats, the new category's automatic fill, the new sandwiches sheet and the foodie moves. */
for (const [seat, id] of Object.entries({ ...batch.placements, ...batch.automaticSeats, ...batch.overflowAfter }))
  assert.equal(ALL_PLACEMENTS[seat], id, seat)
const soul = BEASTY_CATEGORIES.find((c) => c.kind === 'soulfood')
assert(soul && CATEGORY_GLYPHS.soulfood, 'BEASTY • Soul Food has its page and drawing')
const soulSeats = Object.keys(ALL_PLACEMENTS).filter((s) => s.startsWith('beasty-soulfood-'))
assert.equal(soulSeats.length, 1 + batch.newCategory.automaticSeats)
assert(CATEGORY_OVERFLOW.some((p) => p.kind === 'sandwiches2' && p.parent === 'sandwiches'), 'More sandwiches sheet exists')
assert.equal(Object.keys(ALL_PLACEMENTS).filter((s) => /^beasty-sandwiches-\d+$/.test(s)).length, 24, 'BEASTY • Sandwiches keeps its 24')
assert.equal(ALL_PLACEMENTS['beasty-foodies2-4'], 'b_foodielatinmami')
assert.equal(ALL_PLACEMENTS['beasty-foodies2-5'], 'b_foodieaemerieedance')
for (const f of [...batch.heavyHitters, ...batch.newbies]) {
  assert.equal(ALL_PLACEMENTS[f.to], f.brand, f.handle)
  assert.equal(Object.values(ALL_PLACEMENTS).filter((id) => id === f.brand).length, 1, f.handle)
}

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
const inline = (id) => reviewsOf(id).filter((r) => r.src).map((r) => r.href)
for (const id of ['b_thecats', 'b_fikscuealameda', 'b_minniebellssf', 'b_thaitableberkeley']) assert.equal(inline(id).length, 4, id)
assert(!inline('b_thaitableberkeley').some((href) => href.includes('/Dew2j0Xi4_H/')), 'Thai Table keeps its four inline films')
assert(!inline('b_thecats').some((href) => href.includes('/C1Yoc-SLpAL/')), 'The Cats plays four films inline')
assert(!inline('b_minniebellssf').some((href) => href.includes('/CwmJD7xIoOC/')), 'the Emeryville film is not inline')
assert(!batch.posts.find((p) => p.code === 'DZZt4XMON95').brand, 'Vicinity is not on BEASTY')
for (const [id, icon] of [
  ['b_littleluccasouthsf', 'little-lucca-south-sf-v125'],
  ['b_minniebellssf', 'minnie-bells-sf-v125'],
  ['b_foodiesfbaydiaries', 'influencer-sfbaydiaries-v125'],
  ['b_foodiebayareabuzz', 'influencer-bayarea-buzz-v125'],
  ['b_foodiewillwanderforfood', 'influencer-willwanderforfood-v125'],
  ['b_foodiejustjasminesingh', 'influencer-justjasminesingh-v125'],
  ['b_foodiefoodiewitabootie408', 'influencer-foodie-wit-a-bootie-408-v125'],
  ['b_foodiejennixchi', 'influencer-jennixchi-v125'],
]) assert.equal(brandById(id).logo.imageUrl, `/icons/${icon}.webp`, id)

const live = process.env.BASE
const db = live ? null : await freshTestDb('batch125')
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

  /* The two new listings: artwork, address, full menu, a film where there is one, and back to the city. */
  const counts = []
  for (const [listing, id, street, film, back] of [
    [batch.listings[0], 'b_littleluccasouthsf', '724 El Camino', null, 'Go to the South San Francisco Goods page'],
    [batch.listings[1], 'b_minniebellssf', '1375 Fillmore', 'Df5kWtZP3rn', 'Go to the San Francisco More goods page'],
  ]) {
    await open(id)
    await page.locator('.brand-logo-zoom-trigger image[href="/icons/' + listing.icon + '.webp"]').waitFor()
    await page.getByText(street, { exact: false }).first().waitFor()
    const count = listing.sections.reduce((n, s) => n + s.items.length, 0)
    counts.push(count)
    await expand(page.getByRole('button', { name: 'Menu · ' + count + ' items', exact: true }))
    assert.equal(await page.locator('.menu-row').count(), count, id)
    assert.equal(await page.locator('.menu-row-price').filter({ hasText: '$0.00' }).count(), 0, id)
    for (const section of listing.sections) assert(await page.locator('.menu-row').filter({ hasText: section.items[0][0] }).count() > 0, section.name)
    if (film) await play(batch.posts.find((p) => p.code === film), id)
    await page.getByRole('button', { name: back, exact: true }).click()
    await page.locator('.brand-body').waitFor({ state: 'hidden' })
    await page.locator('.home-page:not([inert]) .home-grid button').filter({ hasText: brandById(id).label }).first().waitFor()
  }

  /* One film from each kind of placement: inline on an existing page, creator page only, no business. */
  for (const [code, owner, creator] of [
    ['Df8MTdZNl96', 'b_fikscuealameda', false],
    ['C1Yoc-SLpAL', 'b_foodiebayareabuzz', true],
    ['DZZt4XMON95', 'b_foodiewillwanderforfood', true],
  ]) {
    await open(owner)
    await play(batch.posts.find((p) => p.code === code), owner, creator)
  }
  if (process.env.ALL_BATCH_CLIPS === '1') {
    for (const post of batch.posts) {
      const inline = post.brand && reviewsOf(post.brand).some((review) => review.href === post.source && review.src)
      const owner = inline ? post.brand : pageOfFoodie(post.by)
      if (!owner) {
        assert(REELS.some((r) => r.href === post.source && r.brandId === post.brand), post.code)
        console.log('ok Watch only', post.code)
        continue
      }
      await open(owner)
      await play(post, owner, !inline)
      console.log('ok muted playback', post.code)
    }
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await open('b_littleluccasouthsf')
  await open('b_minniebellssf')
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
  console.log(`PASS Batch 125 on ${iphone ? 'iPhone WebKit' : 'Chrome'}: Little Lucca (${counts[0]} menu items) and Minnie Bell’s (${counts[1]}), BEASTY • Soul Food (${soulSeats.length} seats), More sandwiches, ${batch.posts.length} credited films, ${batch.updatedIcons.length} icons, three Heavy Hitter seats, muted playback and phone layout.`)
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
