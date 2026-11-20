/* Verify the Tada and BSTY Goods release. BASE selects the public host. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, devices, webkit } from 'playwright'
import { tsImport } from 'tsx/esm/api'
import { freshTestDb } from './pgtest.mjs'
import { navigate } from './live-navigation.mjs'

const batch = JSON.parse(readFileSync('research/roster/batch126.json', 'utf8'))
const { ALL_PLACEMENTS } = await tsImport('../src/data/categorySeats.ts', import.meta.url)
const { REELS } = await tsImport('../src/data/clips.ts', import.meta.url)
const { pageOfFoodie, reviewsBy, reviewsOf } = await tsImport('../src/data/foodieIndex.ts', import.meta.url)
const restaurant = 'b_tadaramen'
assert.equal(ALL_PLACEMENTS['oakland-goods2-9'], restaurant)
assert.equal(ALL_PLACEMENTS['beasty-foodies2-368'], 'b_foodieyunamomimood')
const reviews = reviewsOf(restaurant)
assert.equal(reviews.filter((review) => review.src).length, 4)
for (const post of batch.posts) {
  const clip = REELS.find((video) => video.href === post.source)
  assert.equal(clip?.src, '/clips/' + post.slug + '.mp4', post.code)
  assert.equal(clip?.brandId, restaurant, post.code)
  assert(reviewsBy(post.by).some((review) => review.href === post.source), post.by)
}

const live = process.env.BASE
const db = live ? null : await freshTestDb('batch126')
const reserve = createServer()
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve))
const port = reserve.address().port
await new Promise((resolve) => reserve.close(resolve))
const base = live ?? 'http://127.0.0.1:' + port
const instance = db ? spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'ignore',
  env: {
    ...process.env, PORT: String(port), DATABASE_URL: db.url, NODE_ENV: 'development',
    GOODS_ENABLED: '1', GOODS_DATABASE_URL: db.url, GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '', RESEND_API_KEY: '', LEAD_EMAIL: '',
  },
}) : null
const iphone = process.env.BROWSER === 'webkit'
const browser = await (iphone ? webkit : chromium).launch(iphone ? {} : { channel: 'chrome', args: ['--mute-audio'] })
try {
  if (instance) {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await fetch(base + '/goods/api/health', { signal: AbortSignal.timeout(1000) }).catch(() => null)
      if (response?.ok) { ready = true; break }
      if (instance.exitCode !== null) break
      await delay(400)
    }
    assert(ready, 'The local host has not started')
  }
  const page = await browser.newPage({
    ...(iphone ? devices['iPhone 13'] : {}),
    viewport: { width: 393, height: 852 },
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await navigate(page, base + '/?b=' + restaurant)
  await page.getByRole('heading', { name: 'Tada Ramen & Yakitori', exact: true }).waitFor()
  const capture = process.env.SCREENSHOT_DIR
  if (capture) mkdirSync(capture, { recursive: true })
  for (const post of batch.posts) {
    const onCreator = post.surface === 'watch-and-creator'
    if (onCreator) await navigate(page, base + '/?b=' + pageOfFoodie(post.by))
    const index = (onCreator ? reviewsBy(post.by) : reviews).findIndex((review) => review.href === post.source)
    assert(index >= 0, post.code)
    const toggle = page.locator('.foodie-review-head').nth(index)
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    const src = '/clips/' + post.slug + '.mp4'
    const video = page.locator(`video[src="${src}"]`).first()
    await video.scrollIntoViewIfNeeded()
    await video.evaluate(async (el) => {
      if (!el.muted) throw new Error('Clip must start muted')
      await el.play()
    })
    await page.waitForFunction((url) => Array.from(document.querySelectorAll('video')).some(
      (video) => video.getAttribute('src') === url && video.currentTime > 0 && video.muted), src)
    await video.evaluate((el) => el.pause())
    if (capture && post.code === 'DfqVk-6xyBo') await page.screenshot({ path: capture + '/tada-reel.jpg' })
    console.log('Played', post.code, post.by)
  }
  await navigate(page, base + '/goods/')
  const logo = page.getByRole('link', { name: 'BSTY Goods home', exact: true }).locator('img')
  await logo.waitFor({ state: 'visible' })
  assert.equal(await logo.getAttribute('src'), '/goods/brand/bsty-goods.svg')
  await logo.evaluate((el) => el.decode())
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  if (capture) await page.screenshot({ path: capture + '/goods-header.jpg', clip: { x: 0, y: 0, width: 393, height: 190 } })
  const flags = await (await fetch(base + '/goods/api/trade-options')).json()
  assert.equal(flags.shipping, false)
  assert.deepEqual(errors, [])
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const media = [
    ...batch.posts.flatMap((post) => ['/clips/' + post.slug + '.mp4', '/clips/' + post.slug + '-poster.webp']),
    ...batch.artworkDispositions.map((art) => art.asset),
  ]
  for (const asset of media) {
    const response = await fetch(base + asset, { signal: AbortSignal.timeout(20000) })
    assert(response.ok, asset)
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(readFileSync('public' + asset)), asset)
  }
  console.log('PASS Batch 126', iphone ? 'iPhone WebKit' : 'Chrome', base)
} finally {
  await browser.close()
  if (instance && instance.exitCode === null && instance.signalCode === null) {
    const stopped = new Promise((resolve) => instance.once('exit', resolve))
    instance.kill('SIGTERM')
    await stopped
  }
  await db?.drop()
}
