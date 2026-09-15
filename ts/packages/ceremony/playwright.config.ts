import { randomUUID } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

// A second invocation must never recreate another run's containers during startup.
const compose = `docker compose -p ceremony-e2e-${randomUUID()} -f e2e/compose.yaml`

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
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
      // Runtime fixtures use their own HTTP origin; run them once per browser below.
      testIgnore: 'runtime.spec.ts',
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
  webServer: [
    {
      // Compose can exit during startup while leaving healthy sibling containers running.
      command: `trap '${compose} down' EXIT; trap 'exit 1' INT TERM; ${compose} up --abort-on-container-exit`,
      url: 'http://127.0.0.1:4986/index.html',
      stdout: 'pipe',
      reuseExistingServer: false,
      timeout: 300000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 },
    },
    {
      command: 'node e2e/build.mjs && node e2e/server.mjs',
      url: 'https://localhost:4881',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
})
