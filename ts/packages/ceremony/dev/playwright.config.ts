import { defineConfig } from '@playwright/test'
import integration from '../playwright.config.js'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30000,
  workers: 1,
  use: { ...integration.use, baseURL: 'https://localhost:4692' },
  projects: integration.projects,
  webServer: {
    command: 'pnpm dev',
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      CEREMONY_APP_PORT: '4692',
      CEREMONY_BRIDGE_ORIGIN: 'https://localhost:4682',
      CEREMONY_CCDP_ORIGIN: process.env.CEREMONY_CCDP_ORIGIN ?? 'https://localhost:4683',
    },
    url: 'https://localhost:4692',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
