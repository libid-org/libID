import { createRequire } from 'node:module'
import { createInterface } from 'node:readline/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(new URL('../../packages/ceremony/package.json', import.meta.url))
const { chromium, firefox, webkit } = require('@playwright/test')
const engine = process.env.CEREMONY_BROWSER || 'chromium',
  url = new URL(process.env.CEREMONY_WALKTHROUGH_URL)
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
  throw new Error('Use the clean HTTPS application URL')
const browser = await { chromium, firefox, webkit }[engine].launch({ headless: false })
const prompt = createInterface({ input: process.stdin, output: process.stdout })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false }),
    page = await context.newPage()
  // No routing, recorded URLs, traces, screenshots, video, console or raw errors.
  await page.goto(url.href)
  const checkpoints = []
  for (const instruction of [
    'Launch from the real application button and complete consent manually.',
    'Observe the foreground Prover; optionally suspend the application tab and resume it.',
    'Check the application outcome and retained popup continuation.',
  ]) {
    const answer = await prompt.question(`${instruction} Enter pass, fail, or unavailable: `)
    if (!['pass', 'fail', 'unavailable'].includes(answer))
      throw new Error('Checkpoint must be pass, fail, or unavailable')
    checkpoints.push(answer)
  }
  const reportedOutcome = await page.evaluate(() => window.result?.status ?? 'unavailable')
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  writeFileSync(
    new URL('./results/walkthrough.json', import.meta.url),
    JSON.stringify({
      at: new Date().toISOString(),
      engine,
      version: browser.version(),
      checkpoints,
      reportedOutcome,
      qualified: false,
    }),
  )
  console.log(
    'Recorded manual checkpoints only. Complete the release qualification matrix separately.',
  )
} finally {
  prompt.close()
  await browser.close()
}
