import { defineConfig, devices } from '@playwright/test'

// The same five-project matrix the ceremony package qualifies against.
// Serial workers: every test drives one popup per page.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',
  use: { ignoreHTTPSErrors: true },
  webServer: {
    command: 'node e2e/build.mjs && node e2e/server.mjs',
    url: 'https://popup.localtest.me:4583/health',
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
