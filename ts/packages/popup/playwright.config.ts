import { defineConfig, devices } from '@playwright/test'

// Browser contexts isolate popup/worker state; the shared harness serves static bytes.
// CI also separates engines onto independent runners.
export default defineConfig({
  testDir: './e2e',
  workers: 2,
  fullyParallel: true,
  timeout: 60_000,
  reporter: 'list',
  use: { ignoreHTTPSErrors: true },
  webServer: {
    command: 'node e2e/build.mjs && node e2e/server.mjs',
    url: 'https://popup.localhost:4583/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
  ],
})
