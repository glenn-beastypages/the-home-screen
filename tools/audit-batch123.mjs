/* November 16–17 intake. Set BASE to verify the public release. */
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
const batch = read('research/roster/batch123.json')
const prior = read('research/roster/b86-b122-coverage.json')
const archive = read('research/roster/b86-b123-coverage.json')
const { ALL_PLACEMENTS } = await tsImport('../src/data/categorySeats.ts', import.meta.url)
const { brandById } = await tsImport('../src/data/brands.ts', import.meta.url)
const { REELS } = await tsImport('../src/data/clips.ts', import.meta.url)
const { reviewsBy, reviewsOf, pageOfFoodie } = await tsImport('../src/data/foodieIndex.ts', import.meta.url)
assert.deepEqual(archive.posts, [...prior.posts, ...batch.posts])
for (const [seat, id] of Object.entries({ ...batch.firstInfluencers, ...batch.placements }))
  assert.equal(ALL_PLACEMENTS[seat], id, seat)
for (const name of batch.sourceMessages.flatMap((row) => row.attachments))
  assert(batch.artworkDispositions.some((item) => item.source === name), name)
for (const post of [...batch.posts, ...batch.previouslyPublished]) {
  const reels = REELS.filter((r) => r.href === post.source)
  assert.equal(reels.length, 1, post.code)
  assert.equal(reels[0].brandId, post.brand, post.code)
  if (post.slug) {
    assert.equal(reels[0].src, `/clips/${post.slug}.mp4`, post.code)
    assert.equal(reels[0].credit, post.credit, post.code)
    assert(reviewsBy(post.by).some((review) => review.href === post.source && review.src))
  }
  const brand = brandById(post.brand)
  const local = [brand.clip, ...(brand.clips ?? []), ...reviewsOf(post.brand)]
  assert(new Set(local.map((clip) => clip?.src).filter(Boolean)).size <= 4, post.brand)
}
assert(reviewsOf('b_lemoncrabrichmond').some((r) => r.href.includes('/DeiXImexmzZ/')))
assert(!reviewsOf('b_lemoncrabhayward').some((r) => r.href.includes('/DeiXImexmzZ/')))
assert.equal(brandById('b_foodiecynlacson').logo.imageUrl, '/icons/influencer-cynlacson-v123.webp')

const live = process.env.BASE
const db = live ? null : await freshTestDb('batch123')
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
  const examples = [
    ['b_jarsemeryville', '5649 Bay', 'DZa0dhoyaaN', 'Emeryville'],
    ['b_lemoncrabrichmond', '1400 Macdonald', 'Df0vZw5xkMs', 'Richmond'],
    ['b_ohcraboakland', '4869 Telegraph', 'Df1a428MW2s', 'Oakland'],
  ]
  for (const [id, address, code, city] of examples) {
    await open(id)
    await page.getByText(address, { exact: false }).first().waitFor()
    if (id === 'b_jarsemeryville') {
      await page.getByRole('button', { name: /Price list.*2 items/ }).click()
      assert.equal(await page.locator('.menu-row.is-quote').count(), 2)
      assert.equal(await page.locator('.menu-row-add').count(), 0)
    }
    const clip = batch.posts.find((p) => p.code === code)
    await play(clip, id)
    await page.getByRole('button', { name: `Go to the ${city} More goods page`, exact: true }).click()
    await page.locator('.brand-body').waitFor({ state: 'hidden' })
    await page.locator('.home-page:not([inert]) .home-grid button').filter({ hasText: brandById(id).label }).first().waitFor()
  }
  const overflow = batch.posts.find((p) => p.code === 'DPP9VfRiWC7')
  const creator = pageOfFoodie(overflow.by)
  await open(creator)
  await play(overflow, creator, true)
  if (process.env.ALL_BATCH_CLIPS === '1') {
    for (const post of batch.posts.filter((entry) => entry !== overflow && !examples.some((example) => example[2] === entry.code))) {
      const inline = reviewsOf(post.brand).some((review) => review.href === post.source && review.src)
      const owner = inline ? post.brand : pageOfFoodie(post.by)
      assert(owner, post.code)
      await open(owner)
      await play(post, owner, !inline)
      console.log('ok muted playback', post.code)
    }
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await open('b_jarsemeryville')
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
  console.log(`PASS Batch 123 on ${iphone ? 'iPhone WebKit' : 'Chrome'}: 3 locations, ${batch.posts.length} new and ${batch.previouslyPublished.length} existing credited films, ${batch.updatedIcons.length} icons, muted playback and phone layout.`)
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
