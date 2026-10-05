import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// already in the environment win. Nothing is printed.
const envFile = process.env.LIBID_TEST_ENV_FILE
if (envFile) {
  process.env.LIBID_TEST_ENV_DIR ??= dirname(envFile)
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined)
      process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
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
    url: 'http://localhost:4695',
    reuseExistingServer: !process.env.CI,
    timeout: 15 * 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 120_000 },
    stdout: 'pipe',
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4695',
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
