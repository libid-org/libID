import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'src',
  testMatch: '*.spec.ts',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4692',
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
    command: 'pnpm dev:app --port 4692',
    cwd: new URL('.', import.meta.url).pathname,
    url: 'http://localhost:4692',
    reuseExistingServer: false,
    timeout: 60000,
  },
})
