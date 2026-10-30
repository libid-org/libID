import { defineConfig, devices } from '@playwright/test'
import { checkSettings, env, loadEnvFile, runnablePlatforms, settingPath } from './e2e/settings.ts'
import { APP_ORIGIN } from './local.ts'

// Test secrets from the file LIBID_TEST_ENV_FILE names; exported values win.
// The runner process checks them once; its workers load this file too.
loadEnvFile()
if (process.env.TEST_WORKER_INDEX === undefined) checkSettings()
const stackLogs = env('LIBID_STACK_LOGS') && settingPath(env('LIBID_STACK_LOGS')!)
const proxy = env('LIBID_TEST_PROXY')
const ci = !!env('CI')

/**
 * The stack's environment: only what the build, Docker and services.ts need.
 * Playwright merges in its own environment, so every other variable, the test
 * accounts' secrets among them, is set empty.
 */
const KEPT = /^(PATH|HOME|USER|TMPDIR|LANG|CI|PNPM_HOME|XDG_\w+|DOCKER_\w+)$/
const stackEnv = Object.fromEntries(
  Object.entries(process.env).map(([name, value]) => [name, KEPT.test(name) ? (value ?? '') : '']),
)

/** Live: real platforms, real notary, real Bridge; no chain. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.live.spec.ts',
  workers: 1,
  // A test: page load and Ready (2 min), the popup (1 min), its driver (3 min)
  // and the outcome (8 min), with margin.
  timeout: 15 * 60_000,
  reporter: [['list']],
  // Start the services and the app only when a test will run, then stop both.
  webServer: runnablePlatforms().length
    ? {
        // exec: Playwright's SIGTERM reaches services.ts, which brings the stack
        // down. LIBID_STACK_LOGS takes all of its output, the build's included.
        command: `${stackLogs ? 'exec >>"$LIBID_STACK_LOGS" 2>&1; ' : ''}pnpm build:deps && exec node services.ts --app`,
        env: { ...stackEnv, ...(stackLogs && { LIBID_STACK_LOGS: stackLogs }) },
        url: APP_ORIGIN,
        reuseExistingServer: false,
        timeout: 10 * 60_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 2 * 60_000 },
      }
    : undefined,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: APP_ORIGIN,
    headless: !env('HEADED'),
    // A hang ends on the action that hangs, not on the test's timeout.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
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
