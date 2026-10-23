import { defineConfig, devices } from '@playwright/test'
import { ACTION, NAVIGATION, STACK_START, STACK_STOP, TEST } from './e2e/budgets.ts'
import { preflight } from './e2e/preflight.ts'
import { envFile, loadEnvFile, tooling, unknownKeys } from './e2e/settings.ts'
import { APP_ORIGIN } from './local.ts'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// set in the environment win. Nothing is printed. The runner process
// checks them once; its workers load this file too.
const runner = process.env.TEST_WORKER_INDEX === undefined
const file = envFile()
if (file) {
  const typos = unknownKeys(loadEnvFile(file))
  if (runner && typos.length)
    console.warn(`${file}: no live test reads ${typos.join(', ')}; check the spelling.`)
}
if (runner) preflight()
const { proxy, headed, ci, stackLogs, platforms } = tooling()
// The services' output carries what the job log must not: CI writes it to a
// file it scans before upload.
if (ci && !stackLogs)
  throw new Error("CI runs need LIBID_STACK_LOGS: a file for the services' output")

/** Live: real platforms, real notary, real Bridge; no chain. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.live.spec.ts',
  workers: 1,
  // Each test's own budgets, summed in e2e/budgets.ts.
  timeout: TEST,
  reporter: [['list']],
  // One command: start the services and the app, test, then stop both. The
  // run never reuses a running stack: services.ts refuses taken ports.
  // No platform selected: nothing to start.
  webServer: platforms.length
    ? {
        // exec: Playwright's SIGTERM reaches services.ts, which brings the stack
        // down. With LIBID_STACK_LOGS, the build's output goes there too.
        command: `pnpm build:deps${stackLogs ? ' >>"$LIBID_STACK_LOGS" 2>&1' : ''} && exec node services.ts --app`,
        ...(stackLogs && {
          env: { ...(process.env as Record<string, string>), LIBID_STACK_LOGS: stackLogs },
        }),
        url: APP_ORIGIN,
        reuseExistingServer: false,
        timeout: STACK_START,
        gracefulShutdown: { signal: 'SIGTERM', timeout: STACK_STOP },
        // Under CI only services.ts' own messages reach the job log.
        stdout: ci ? 'ignore' : 'pipe',
      }
    : undefined,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: APP_ORIGIN,
    headless: !headed,
    // A hang ends on the action that hangs, not on the test's timeout.
    actionTimeout: ACTION,
    navigationTimeout: NAVIGATION,
    // Automation X and Google can see makes them challenge; see e2e/person.ts.
    launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
    // LIBID_TEST_PROXY routes the browser's traffic, loopback aside, through a
    // proxy: the platforms then see the proxy's address instead of this host's.
    ...(proxy && { proxy: { server: proxy, bypass: 'localhost,127.0.0.1,[::1]' } }),
    // A trace records every fill and cookie, the test accounts' password and
    // sessions included, so CI keeps screenshots only.
    trace: ci ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: ci ? 'off' : 'retain-on-failure',
  },
})
