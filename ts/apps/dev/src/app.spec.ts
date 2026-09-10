import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const configUrl = 'https://localhost:4682/api/v1/ceremony/config'
const ccdp = process.env.CEREMONY_CCDP_ORIGIN ?? 'https://localhost:4683'
const config = {
  redirectUri: 'https://localhost:4682/auth/callback',
  ccdpOrigin: ccdp,
  platforms: {
    google: { clientId: '407408718192.apps.googleusercontent.com', ceremonyVersions: [1] },
    github: { clientId: 'test-client', ceremonyVersions: [2] },
  },
}
test('unavailable Bridge disables launch; reload loads compatible platforms', async ({ page }) => {
  let available = false
  await page.route(configUrl, (route) =>
    available
      ? route.fulfill({ json: config })
      : route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Could not load Bridge configuration')
  await expect(page.getByRole('link', { name: 'Start ceremony' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0)
  available = true
  await page.reload()
  await expect(page.getByRole('status')).toContainText('Ready.')
  await expect(page.locator('#platform option')).toHaveText(['Google'])
  await expect(page.getByRole('link', { name: 'Start ceremony' })).toHaveAttribute(
    'aria-disabled',
    'false',
  )
})
test('no compatible platforms stays unavailable', async ({ page }) => {
  await page.route(configUrl, (route) => route.fulfill({ json: { ...config, platforms: {} } }))
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('no compatible platforms')
  await expect(page.getByRole('link', { name: 'Start ceremony' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
for (const blocked of [false, true]) {
  test(`real popup launch${blocked ? ' through the native anchor' : ''}, cancellation and retry`, async ({
    page,
    context,
  }) => {
    if (blocked)
      await page.addInitScript(() => {
        window.open = () => null
      })
    await page.route(configUrl, (route) => route.fulfill({ json: config }))
    // Only transport setup is exercised here. No simulated proof delivery or OAuth consent.
    await context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Prefetch test boundary</title>',
      }),
    )
    await page.goto('/')
    await expect(page.getByRole('status')).toContainText('Ready.')
    const opened = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Start ceremony' }).click()
    const popup = await opened
    await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
    await expect(page.getByRole('button', { name: 'Cancel ceremony' })).toBeEnabled()
    await page.getByRole('button', { name: 'Cancel ceremony' }).click()
    await expect(page.locator('#result')).toHaveText('Ceremony cancelled.')
    // This inert fallback has no handle or authenticated carrier to receive closure.
    if (blocked) await popup.close()
    else await expect.poll(() => popup.isClosed()).toBe(true)
    await expect(page.getByRole('link', { name: 'Start ceremony' })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
    expect(await page.evaluate(() => window.result)).toEqual({ status: 'cancelled' })
  })
}

test('private configuration and generated files are not served', async ({ request }) => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const directory = mkdtempSync(join(root, '.cache/private-file-test-'))
  const file = join(directory, 'probe.json')
  writeFileSync(file, '{}')
  try {
    for (const path of [join(root, '.env.example'), file]) {
      const response = await request.get(`/@fs${path}`)
      expect(response.status(), path).toBe(403)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
