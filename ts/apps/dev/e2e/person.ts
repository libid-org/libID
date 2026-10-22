import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from '@playwright/test'

/** The Chrome these tests present as: a person's, on an Intel Mac. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

const brand = (name: string, version: string) => ({ brand: name, version })

/** Client hints matching USER_AGENT, which Chrome reports in navigator.userAgentData and sec-ch-ua. */
const userAgentOverride = {
  userAgent: USER_AGENT,
  acceptLanguage: 'en-US,en;q=0.9',
  platform: 'macOS',
  userAgentMetadata: {
    brands: [brand('Chromium', '145'), brand('Not:A-Brand', '99'), brand('Google Chrome', '145')],
    fullVersionList: [
      brand('Chromium', '145.0.0.0'),
      brand('Not:A-Brand', '99.0.0.0'),
      brand('Google Chrome', '145.0.0.0'),
    ],
    platform: 'macOS',
    platformVersion: '15.3.0',
    architecture: 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  },
}

async function presentPage(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setUserAgentOverride', userAgentOverride)
}

/**
 * Make every page of `context` read as a person's Chrome: the user agent and
 * its client hints, and the stealth script before any page script. X and
 * Google challenge automation they can see. Ported from libid-server-rs'
 * ceremony-tests/src/browser/person.rs.
 */
export async function presentAsPerson(context: BrowserContext) {
  await context.addInitScript({ path: fileURLToPath(new URL('./stealth.js', import.meta.url)) })
  for (const page of context.pages()) await presentPage(context, page)
  context.on('page', (page) => void presentPage(context, page).catch(() => {}))
}
