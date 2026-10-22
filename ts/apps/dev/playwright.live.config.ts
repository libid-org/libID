import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// already in the environment win. Nothing is printed.
const envFile = process.env.LIBID_TEST_ENV_FILE
if (envFile) {
  process.env.LIBID_TEST_ENV_DIR ??= dirname(envFile)
  for (const [name, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8'))))
    process.env[name] ??= value
}

/** dev's application and services (services.ts, vite.config.ts). */
const APP_ORIGIN = 'http://localhost:4691'

/** Live: real platforms, real notary, real Bridge; no chain. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.live.spec.ts',
  workers: 1,
  // Each test: the popup driver's 3 minutes and the page's 8-minute outcome wait.
  timeout: 12 * 60_000,
  reporter: [['list']],
  // One command: start the services and the app, test, then stop both. A
  // `pnpm dev` already running locally is reused.
  webServer: {
    command: 'pnpm dev',
    url: APP_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 10 * 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 120_000 },
    // CI keeps the services' output off the public job log: services.ts
    // writes it to LIBID_STACK_LOGS, which is scanned before upload.
    stdout: process.env.CI ? 'ignore' : 'pipe',
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: APP_ORIGIN,
    headless: !process.env.HEADED,
    // Automation X and Google can see makes them challenge; see e2e/person.ts.
    launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
    // LIBID_TEST_PROXY routes the browser's traffic, loopback aside, through a
    // proxy: the platforms then see the proxy's address instead of this host's.
    ...(process.env.LIBID_TEST_PROXY && {
      proxy: { server: process.env.LIBID_TEST_PROXY, bypass: 'localhost,127.0.0.1,[::1]' },
    }),
    // A trace records every fill and cookie, the test accounts' password and
    // sessions included, so CI keeps screenshots only.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'off' : 'retain-on-failure',
  },
})
