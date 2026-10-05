import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'
import { APP_ORIGIN } from './local.ts'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// already in the environment win. Nothing is printed.
const envFile = process.env.LIBID_TEST_ENV_FILE
if (envFile) {
  process.env.LIBID_TEST_ENV_DIR ??= dirname(envFile)
  for (const [name, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8'))))
    process.env[name] ??= value
}

/** Live: real platforms, real notary, real chain. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.live.spec.ts',
  workers: 1,
  timeout: 10 * 60_000,
  reporter: [['list']],
  // One command: start the stack and the app, test, then stop both. A stack
  // already running locally is reused.
  webServer: {
    command: 'pnpm dev',
    url: APP_ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 15 * 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 120_000 },
    stdout: 'pipe',
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: APP_ORIGIN,
    headless: !process.env.HEADED,
    // Automation X and Google can see makes them challenge; see e2e/person.ts.
    launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
    // A trace records every fill and cookie, the test accounts' password and
    // sessions included, so CI keeps screenshots only.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'off' : 'retain-on-failure',
  },
})
