import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { verifyBrowserProof } from './verify.mjs'

const require = createRequire(new URL('../../packages/ceremony/package.json', import.meta.url))
const playwright = require('@playwright/test')
const engine = process.argv[2] || 'chromium',
  platform = process.argv[3] || 'bearer',
  pageUrl = process.argv[4] || 'http://localhost:4686',
  notaryAddress = process.argv[5] || 'http://localhost:4687',
  pageTarget = new URL(pageUrl),
  loopback = ['localhost', '127.0.0.1'].includes(pageTarget.hostname)
if (pageTarget.protocol !== 'https:' && !(pageTarget.protocol === 'http:' && loopback))
  throw new Error('Qualification requires HTTPS or explicit loopback HTTP')
const browser = await playwright[engine].launch({ headless: true })
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.text().startsWith('SMOKE ')) console.log(m.text())
  })
  page.on('pageerror', (e) => console.error('Page error:', e.message))
  page.on('requestfailed', (r) => console.error('Request failed:', r.url(), r.failure()?.errorText))
  await page.goto(pageUrl)
  await page.waitForFunction(() => typeof window.proveFixture === 'function')
  console.log('Running', engine, platform)
  const timeout = setTimeout(() => {
    console.error('Engine smoke timed out')
    void browser.close()
  }, 480000)
  try {
    const result = await page.evaluate(
      async ({ platform, notaryAddress }) =>
        platform.startsWith('notary')
          ? await window.notarySmoke(platform === 'notary-single' ? 1 : 2, notaryAddress)
          : await window.proveFixture(platform),
      { platform, notaryAddress },
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
        pageUrl,
        ...(platform.startsWith('notary') ? { notaryAddress } : {}),
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
