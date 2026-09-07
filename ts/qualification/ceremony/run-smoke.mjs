import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { verifyBrowserProof } from './verify.mjs'
const require = createRequire(new URL('../../packages/ceremony/package.json', import.meta.url))
const playwright = require('@playwright/test')
const engine = process.argv[2] || 'chromium',
  platform = process.argv[3] || 'bearer'
const browser = await playwright[engine].launch({
  headless: true,
  ...(engine === 'chromium' ? { args: ['--ignore-certificate-errors'] } : {}),
})
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true })
  page.on('console', (m) => {
    if (m.text().startsWith('SMOKE ')) console.log(m.text())
  })
  page.on('pageerror', (e) => console.error('Page error:', e.message))
  page.on('requestfailed', (r) => console.error('Request failed:', r.url(), r.failure()?.errorText))
  await page.goto('https://localhost:4686')
  await page.waitForFunction(() => typeof window.proveFixture === 'function')
  console.log('Running', engine, platform)
  const timeout = setTimeout(() => {
    console.error('Engine smoke timed out')
    void browser.close()
  }, 480000)
  try {
    const result = await page.evaluate(
      async (platform) =>
        platform.startsWith('notary')
          ? await window.notarySmoke(platform === 'notary-single' ? 1 : 2)
          : await window.proveFixture(platform),
      platform,
    )
    if (!platform.startsWith('notary'))
      await verifyBrowserProof(platform === 'google' ? 'oidc_google' : 'bearer_link', result)
    mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
    writeFileSync(
      new URL(`./results/${engine}-${platform}.json`, import.meta.url),
      JSON.stringify({
        engine,
        version: browser.version(),
        platform,
        verified: !platform.startsWith('notary'),
        result,
      }),
    )
    console.log('PASS', engine, platform)
  } finally {
    clearTimeout(timeout)
  }
} finally {
  await browser.close()
}
