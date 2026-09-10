import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'https://localhost:4881',
    ignoreHTTPSErrors: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    ...(['chromium', 'firefox', 'webkit'] as const).map((browserName) => ({
      name: `${browserName}-http`,
      use: { browserName, baseURL: 'http://localhost:4781', ignoreHTTPSErrors: false },
    })),
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: { args: ['--ignore-certificate-errors'] } },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'android-emulated',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    { name: 'ios-emulated', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'node e2e/build.mjs && node e2e/server.mjs',
    url: 'https://localhost:4881',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
