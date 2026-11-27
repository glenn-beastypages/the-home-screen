/* BASE selects production. BROWSER=webkit uses the iPhone 13 profile. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, devices, webkit } from 'playwright'
import { tsImport } from 'tsx/esm/api'
import { freshTestDb } from './pgtest.mjs'
import { navigate } from './live-navigation.mjs'

const batchNumber = process.env.BATCH ?? '127'
assert(/^\d+$/.test(batchNumber))
const batch = JSON.parse(readFileSync(`research/roster/batch${batchNumber}.json`, 'utf8'))
const posts = [...batch.posts, ...(batch.reconfirmedPosts ?? [])]
const artwork = [...batch.artworkDispositions, ...(batch.reconfirmedArtwork ?? [])]
const { ALL_PLACEMENTS } = await tsImport('../src/data/categorySeats.ts', import.meta.url)
const { REELS } = await tsImport('../src/data/clips.ts', import.meta.url)
const { pageOfFoodie, reviewsBy, reviewsOf } = await tsImport('../src/data/foodieIndex.ts', import.meta.url)
for (const [seat, brand] of Object.entries(batch.placements)) {
  assert.equal(ALL_PLACEMENTS[seat], brand, seat)
}
for (const post of posts) {
  const clip = REELS.find((reel) => reel.href === post.reel)
  assert.equal(clip?.src, post.asset, post.code)
  assert.equal(clip?.poster, post.poster, post.code)
  assert.equal(clip?.brandId, post.brand, post.code)
  assert(clip?.credit.includes('@' + post.by), post.code)
}

const iphone = process.env.BROWSER === 'webkit'
const live = process.env.BASE
const reserve = createServer()
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve))
const port = reserve.address().port
await new Promise((resolve) => reserve.close(resolve))
const base = live ?? 'http://127.0.0.1:' + port
const capture = process.env.SCREENSHOT_DIR
if (capture) mkdirSync(capture, { recursive: true })
const db = live ? null : await freshTestDb('batch' + batchNumber)
const instance = db ? spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'ignore',
  env: {
    ...process.env, PORT: String(port), NODE_ENV: 'development', DATABASE_URL: db.url,
    GOODS_ENABLED: '1', GOODS_DATABASE_URL: db.url, GOODS_DEMO_CATALOG: '1',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', RESEND_API_KEY: '', LEAD_EMAIL: '',
  },
}) : null

let browser
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
  browser = await (iphone ? webkit : chromium).launch(iphone ? {} : { channel: 'chrome', args: ['--mute-audio'] })
  const page = await browser.newPage(iphone ? devices['iPhone 13'] : { viewport: { width: 1380, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const openBrand = async (brand) => {
    assert(brand, 'Missing creator page')
    await navigate(page, base + '/?b=' + brand)
    await page.locator('.brand-hero').first().waitFor({ timeout: 15000 })
    // The hero mounts while the home tile is still expanding. Tap after it reaches full size.
    await page.waitForFunction(() => document.querySelector('.app-window')?.style.willChange === 'auto')
  }
  const verifyPlayback = async (video) => {
    await video.scrollIntoViewIfNeeded()
    await video.evaluate(async (el) => {
      if (!el.muted) throw new Error('Clip must start muted')
      await el.play()
    })
    await video.evaluate((el) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video time did not advance')), 6000)
      el.addEventListener('timeupdate', () => { clearTimeout(timeout); resolve() }, { once: true })
    }))
    await video.evaluate((el) => el.pause())
  }

  for (const post of posts) {
    const onCreator = post.clip === 'creator'
    await openBrand(onCreator ? pageOfFoodie(post.by) : post.brand)
    const selector = 'video[src="' + post.asset + '"]'
    if (post.clip === 'primary') {
      await page.locator('.brand-clip-drop button[aria-expanded]').first().click()
      await verifyPlayback(page.locator('.brand-clip-drop ' + selector))
    } else {
      const reviews = onCreator ? reviewsBy(post.by) : reviewsOf(post.brand)
      const index = reviews.findIndex((review) => review.href === post.reel)
      assert(index >= 0, post.code)
      const row = page.locator('.foodie-review').nth(index)
      await row.locator('.foodie-review-head').click()
      await row.locator('a[href="' + post.reel + '"]').waitFor()
      await verifyPlayback(row.locator(selector))
    }
    console.log('Played', post.code, post.by)
  }

  for (const [brand, expected] of Object.entries(batch.backgroundChecks)) {
    await openBrand(brand)
    const film = page.locator('.brand-film video')
    assert.equal(await film.getAttribute('src'), expected, brand)
    await page.waitForFunction(() => {
      const video = document.querySelector('.brand-film video')
      return video?.muted && video.loop && video.playsInline && video.currentTime > 0
    }, undefined, { timeout: 10000 })
    if (capture) await page.screenshot({ path: capture + '/' + brand + '.jpg' })
    console.log('Background plays automatically', brand)
  }

  for (const { profilePage, asset } of artwork) {
    await openBrand(profilePage)
    const trigger = page.locator('.brand-logo-zoom-trigger')
    await trigger.scrollIntoViewIfNeeded()
    if (iphone) await trigger.tap()
    else await trigger.click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('img[src="' + asset + '"]').evaluate((img) => img.decode())
    await dialog.getByRole('button', { name: /Close enlarged/ }).click()
  }

  for (const [id, listing] of Object.entries(batch.listings ?? {})) {
    await openBrand(id)
    await page.getByRole('heading', { name: listing.name, exact: true }).waitFor()
    if (batch.menus[id].pricedItems) {
      const count = batch.menus[id].pricedItems
      await page.getByRole('button', { name: 'Menu · ' + count + ' items', exact: true }).click()
      assert.equal(await page.locator('.menu-row').count(), count, id)
    }
    await page.getByRole('button', { name: 'Go to the ' + listing.city + ' ' + (listing.cityPage ?? 'More goods') + ' page' }).click()
    const tile = page.locator('.home-page:not([inert]) .home-grid').getByRole('button', { name: listing.name, exact: true })
    await tile.click()
    await page.getByRole('heading', { name: listing.name, exact: true }).waitFor()
    console.log('Opened city tile', listing.city, listing.name)
  }

  for (const { group, entry, page: sheet, id, expectMembersOnlyNext } of batch.discoveryChecks ?? []) {
    const city = group === 'Cities' ? entry : 'BEASTY'
    await navigate(page, base + '/search')
    await page.getByRole('button', { name: group, exact: true }).click()
    await page.locator('#search-drop-' + group.toLowerCase()).getByText(entry, { exact: true }).click()
    await page.locator('.page-dots [aria-current="page"][aria-label$=", ' + city + ', ' + sheet + '"]').waitFor()
    if (expectMembersOnlyNext) {
      await page.getByRole('button', { name: 'Next page', exact: true }).click()
      await page.getByRole('dialog', { name: 'Sign in or sign up to continue' }).waitFor()
      console.log('Verified guest sign-in prompt on', entry)
      continue
    }
    const title = batch.listings[id].name
    const tile = page.locator('.home-page:not([inert]) .home-grid').getByRole('button', { name: title, exact: true })
    await tile.click()
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    console.log('Discovered', title, 'through', entry, 'on', sheet)
  }

  await navigate(page, base + '/goods/')
  const logo = page.getByRole('link', { name: 'BSTY Goods home', exact: true }).locator('img')
  await logo.evaluate((img) => img.decode())
  assert.equal(await logo.getAttribute('src'), '/goods/brand/bsty-goods.svg')
  if (batch.goodsIntroduction) {
    await page.getByRole('link', { name: /Closets for a Cause/ }).click()
    await page.getByRole('heading', { name: 'Closets for a Cause', exact: true }).waitFor()
    await page.reload()
    await page.getByText('How the auction is planned', { exact: true }).waitFor()
    const apply = page.getByRole('link', { name: /Sign in to apply/ })
    assert.equal(await apply.getAttribute('href'), '/goods/login?returnTo=' + encodeURIComponent(batch.goodsIntroduction))
    if (capture) await page.screenshot({ path: capture + '/closets-for-a-cause.jpg' })
    await apply.click()
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), batch.goodsIntroduction)
    await page.getByRole('link', { name: 'BSTY Goods home', exact: true }).click()
  }
  await page.locator('.product-title').first().click()
  const description = page.locator('.item-detail-block .preserve-lines')
  await description.waitFor({ state: 'visible' })
  const inspectListing = async () => {
    assert.equal(await description.evaluate((el) => getComputedStyle(el).fontSize), batch.goodsDescriptionSize ?? '16px')
    const heading = description.locator('..').getByRole('heading', { name: 'Description' })
    assert(await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 17), 'Readable Goods listing heading')
    assert.equal(await page.locator('.item-facts span, .listing-specs dt').first().evaluate((el) => getComputedStyle(el).fontSize), '14px')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await inspectListing()
  if (capture) {
    await description.scrollIntoViewIfNeeded()
    await page.screenshot({ path: capture + '/goods-listing.jpg' })
  }
  if (iphone) {
    await page.setViewportSize({ width: 320, height: 720 })
    await inspectListing()
  }

  assert.deepEqual(errors, [])
  // Compare the fetched assets to the release, including clips used on multiple surfaces.
  const media = [
    ...posts.flatMap((post) => [post.asset, post.poster]),
    ...artwork.map((art) => art.asset),
  ]
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  for (const asset of media) {
    const response = await fetch(base + asset, { signal: AbortSignal.timeout(20000) })
    assert(response.ok, asset)
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(readFileSync('public' + asset)), asset)
  }
  console.log('PASS Batch', batchNumber, iphone ? 'iPhone WebKit' : 'Chrome', base)
} finally {
  await browser?.close()
  if (instance && instance.exitCode === null && instance.signalCode === null) {
    const stopped = new Promise((resolve) => instance.once('exit', resolve))
    instance.kill('SIGTERM')
    await stopped
  }
  await db?.drop()
}
