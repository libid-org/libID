import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'
import type { AssetRequest } from '../src/assets/index.js'
import { origins } from './topology.js'

export { expect }

const graph = new URL('../.cache/qualification-assets/distribution-graph.json', import.meta.url)

/** The exact requests of `profile` in the emitted graph of the artifact the harness serves. */
export const artifactRequests = (profile: string): AssetRequest[] =>
  JSON.parse(readFileSync(graph, 'utf8')).requestsByProfile[profile]

export const test = base.extend<{
  app: string
  bridge: string
  ccdp: string
  assetControl: (asset: string) => string
  /** Answer Google authorization by redirecting to `target(state)`; by default, a denial. */
  provider: (target?: (state: string) => string) => Promise<void>
  /** Open the application at `search`, run `prepare`, then launch; resolves to the popup. */
  launch: (search?: string, prepare?: () => Promise<unknown>) => Promise<Page>
}>({
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
  app: async ({ baseURL }, use) => {
    await use(baseURL!)
  },
  bridge: async ({ app }, use) => {
    await use(origins(app.startsWith('https:')).bridge)
  },
  ccdp: async ({ app }, use) => {
    await use(origins(app.startsWith('https:')).ccdp)
  },
  provider: async ({ bridge, context }, use) => {
    await use(
      async (target = (state) => `${bridge}/auth/callback#error=access_denied&state=${state}`) => {
        await context.route('https://accounts.google.com/**', async (route) => {
          const state = new URL(route.request().url()).searchParams.get('state')!
          await route.fulfill({
            contentType: 'text/html',
            body: `<script>location.replace(${JSON.stringify(target(state))})</script>`,
          })
        })
      },
    )
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
