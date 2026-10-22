import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'
import { checkSettings, envFile, tooling, unknownKeys } from './e2e/settings.ts'
import { APP_ORIGIN } from './local.ts'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// already in the environment win. Nothing is printed. The runner process
// checks them once; its workers load this file too.
const runner = process.env.TEST_WORKER_INDEX === undefined
const file = envFile()
if (file) {
  const values = parseEnv(readFileSync(file, 'utf8'))
  for (const [name, value] of Object.entries(values)) process.env[name] ??= value
  const typos = unknownKeys(Object.keys(values))
  if (runner && typos.length)
    console.warn(`${file}: no live test reads ${typos.join(', ')}; check the spelling.`)
}
if (runner) checkSettings()
const { proxy } = tooling()

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
    ...(proxy && { proxy: { server: proxy, bypass: 'localhost,127.0.0.1,[::1]' } }),
    // A trace records every fill and cookie, the test accounts' password and
    // sessions included, so CI keeps screenshots only.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'off' : 'retain-on-failure',
  },
})
