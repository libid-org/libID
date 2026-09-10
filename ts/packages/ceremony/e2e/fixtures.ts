import { test as base, expect } from '@playwright/test'
export { expect }
export const test = base.extend<{ app: string; bridge: string; ccdp: string }>({
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
