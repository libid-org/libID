import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'src',
  testMatch: '*.spec.ts',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'https://localhost:4692',
    ignoreHTTPSErrors: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'android-emulated', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'ios-emulated', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm dev:app',
    cwd: new URL('.', import.meta.url).pathname,
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
