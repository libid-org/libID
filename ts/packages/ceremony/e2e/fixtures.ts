import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import type { AssetRequest } from '../src/assets/index.js'
import type { PlatformId } from '../src/platforms/index.js'
import { browserPlatforms } from './platforms.js'
import { origins } from './topology.js'

export { expect }

const graph = new URL('../.cache/qualification-assets/distribution-graph.json', import.meta.url)

/** The exact requests of `profile` in the emitted graph of the artifact the harness serves. */
export const artifactRequests = (profile: string): AssetRequest[] =>
  JSON.parse(readFileSync(graph, 'utf8')).requestsByProfile[profile]

/** A provider page that immediately continues to `url`, as an authorization redirect would. */
const redirect = (url: string) => ({
  contentType: 'text/html',
  body: `<script>location.replace(${JSON.stringify(url)})</script>`,
})

/** A Prover popup after handoff: private inputs cleared and cross-origin isolated. */
export async function expectIsolatedProver(popup: Page): Promise<void> {
  expect(await popup.evaluate(() => location.hash)).toBe('')
  expect(await popup.evaluate(() => crossOriginIsolated)).toBe(true)
}

/** Failure diagnostics for one popup document, which may already be gone. */
export const describePopup = (popup: Page) =>
  popup
    .evaluate(() => ({
      path: location.pathname,
      status: document.querySelector('[role="status"]')?.textContent,
      readyState: document.readyState,
      worker: navigator.serviceWorker.controller?.state,
    }))
    .catch(() => 'document unavailable')

/** Application reuses its connection after the ceremony: a plain CCDP page answers it. */
export async function expectApplicationContinues(page: Page): Promise<void> {
  await page.evaluate(() => window.after())
  await expect.poll(() => page.evaluate(() => window.afterReady)).toBe(true)
}

export interface Fixtures {
  app: string
  bridge: string
  ccdp: string
  /** The control URL of one CCDP asset; held bodies and failures are released after the test. */
  assetControl: (asset: string) => string
  /** How many times the harness has served `asset` so far. */
  assetCount: (asset: string) => Promise<number>
  /** Answer Google authorization by redirecting to `target(state, nonce)`; by default, a denial. */
  googleProvider: (target?: (state: string, nonce: string) => string) => Promise<void>
  /**
   * Check `platform`'s authorization request against its table registration and answer it
   * with `fields` (or the fields computed from the request) and its state in the provider's return
   * transport; resolves to the requests seen.
   */
  authorize: (
    platform: PlatformId,
    fields: Record<string, string> | ((request: URLSearchParams) => Record<string, string>),
  ) => Promise<URLSearchParams[]>
  /** Open the application at `search`, run `prepare`, then launch; resolves to the popup. */
  launch: (search?: string, prepare?: () => Promise<unknown>) => Promise<Page>
}

export const test = base.extend<Fixtures>({
  // Release held bodies and simulated failures before the request client is disposed,
  // even when a timeout leaves the test body (and its finally block) still pending.
  assetControl: async ({ ccdp, request }, use) => {
    const controls = new Set<string>()
    try {
      await use((asset) => {
        const url = `${ccdp}/qualification-control?asset=${encodeURIComponent(asset)}`
        controls.add(url)
        return url
      })
    } finally {
      for (const url of controls)
        await request.get(`${url}&release&restore`, { failOnStatusCode: true })
    }
  },
  assetCount: async ({ assetControl, request }, use) => {
    await use(async (asset) => (await (await request.get(assetControl(asset))).json()).count)
  },
  app: async ({ baseURL }, use) => {
    await use(baseURL!)
  },
  bridge: async ({ app }, use) => {
    await use(origins(app.startsWith('https:')).bridge)
  },
  ccdp: async ({ app }, use) => {
    await use(origins(app.startsWith('https:')).ccdp)
  },
  googleProvider: async ({ bridge, context }, use) => {
    await use(
      async (target = (state) => `${bridge}/auth/callback#error=access_denied&state=${state}`) => {
        await context.route('https://accounts.google.com/**', async (route) => {
          const params = new URL(route.request().url()).searchParams
          await route.fulfill(redirect(target(params.get('state')!, params.get('nonce')!)))
        })
      },
    )
  },
  authorize: async ({ bridge, context }, use) => {
    await use(async (platform, fields) => {
      const { authorization, clientId, pkce, returns, issuer } = browserPlatforms[platform]
      const requests: URLSearchParams[] = []
      await context.route(`${authorization}?**`, async (route) => {
        const params = new URL(route.request().url()).searchParams
        requests.push(params)
        expect(params.get('client_id')).toBe(clientId)
        if (pkce) expect(params.get('code_challenge_method')).toBe('S256')
        const answer = typeof fields === 'function' ? fields(params) : fields
        const returned = new URLSearchParams({ ...answer, state: params.get('state')! })
        if (issuer) returned.set('iss', issuer)
        const separator = returns === 'query' ? '?' : '#'
        await route.fulfill(redirect(`${bridge}/auth/callback${separator}${returned}`))
      })
      return requests
    })
  },
  launch: async ({ app, context, page }, use) => {
    await use(async (search = '', prepare) => {
      await page.goto(app + search)
      await page.waitForFunction(() => window.ready)
      await prepare?.()
      const opened = context.waitForEvent('page')
      await page.locator('#launch').click()
      return opened
    })
  },
})
