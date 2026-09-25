import { test as base, expect } from '@playwright/test'

export { expect }

export const test = base.extend<{
  app: string
  bridge: string
  ccdp: string
  assetControl: (asset: string) => string
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
    const url = new URL(app)
    url.port = String(Number(url.port) + 1)
    await use(url.origin)
  },
  ccdp: async ({ app }, use) => {
    const url = new URL(app)
    url.port = String(Number(url.port) + 2)
    await use(url.origin)
  },
})
