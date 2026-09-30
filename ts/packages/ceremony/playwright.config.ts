import { randomUUID } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { crsProxy, origins, runtime } from './e2e/topology.js'

// A second invocation must never recreate another run's containers during startup.
const compose = `docker compose -p ceremony-e2e-${randomUUID()} -f e2e/compose.yaml`

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  // Shared asset controls and CPU-heavy qualification stay serial within each CI engine job.
  workers: 1,
  retries: 0,
  use: {
    baseURL: origins(true).app,
    ignoreHTTPSErrors: true,
    // The CRS comes from the harness cache (e2e/crs.mjs), not Aztec's CDN.
    proxy: { server: `http://127.0.0.1:${crsProxy}`, bypass: 'localhost,127.0.0.1' },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    ...(['chromium', 'firefox', 'webkit'] as const).map((browserName) => ({
      name: `${browserName}-http`,
      // Full proofs/runtime qualification run once per engine in the desktop HTTPS projects.
      testIgnore: 'runtime.spec.ts',
      grepInvert: /@proof/,
      // The origins are plain HTTP; the only HTTPS left is the locally served CRS, whose harness
      // certificate Chromium's Service Worker fetches accept only with the launch flag.
      use: {
        browserName,
        baseURL: origins(false).app,
        ...(browserName === 'chromium' && {
          launchOptions: { args: ['--ignore-certificate-errors'] },
        }),
      },
    })),
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: { args: ['--ignore-certificate-errors'] } },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'android-emulated',
      testIgnore: 'runtime.spec.ts',
      grepInvert: /@proof/,
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    {
      name: 'ios-emulated',
      testIgnore: 'runtime.spec.ts',
      grepInvert: /@proof/,
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
    },
  ],
  webServer: [
    {
      // Build every input first, so a bare `playwright test` qualifies current artifacts. Compose
      // can exit during startup while leaving healthy sibling containers running.
      command: `node e2e/build.mjs || exit 1; trap '${compose} down' EXIT; trap 'exit 1' INT TERM; ${compose} up --abort-on-container-exit`,
      url: `http://127.0.0.1:${runtime}/index.html`,
      stdout: 'pipe',
      reuseExistingServer: false,
      timeout: 300000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 },
    },
    {
      command: 'node e2e/server.mjs',
      url: origins(true).app,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
})
