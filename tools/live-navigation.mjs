import { setTimeout } from 'node:timers/promises'

const transientStatus = new Set([429, 502, 503, 504])
const transientError = /net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|ABORTED|TIMED_OUT)|network connection was lost|navigation.*interrupted/i

/** A live navigation can lose its connection while Render is serving releases. */
export async function navigate(page, url, { timeout = 45000 } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
      if (!transientStatus.has(response?.status())) return response
      if (attempt === 3) throw new Error(`${url} returned HTTP ${response.status()}`)
    } catch (error) {
      if (attempt === 3 || (error.name !== 'TimeoutError' && !transientError.test(error.message))) throw error
    }
    console.log(`Retrying navigation to ${url} (${attempt}/2)`)
    await setTimeout(attempt * 350)
  }
}
