import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Test secrets from a dotenv file when LIBID_TEST_ENV_FILE names one; values
// already in the environment win. Nothing is printed.
const envFile = process.env.LIBID_TEST_ENV_FILE
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
}

/** Live: real GitHub, real notary, real chain. Needs `pnpm dev` running. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.live.spec.ts',
  workers: 1,
  timeout: 10 * 60_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4695',
    headless: !process.env.HEADED,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
