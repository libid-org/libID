import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  await expect(page.locator('#platforms').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0)
  available = true
  await page.reload()
  await expect(page.getByRole('status')).toContainText('Ready.')
  await expect(page.locator('dl')).toContainText('https://localhost:4687')
  await expect(page.locator('dl')).not.toContainText('Ledger')
  await expect(page.locator('#platforms').getByRole('button')).toHaveText(['Google'])
  await expect(page.getByRole('button', { name: 'Google', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  )
})
test('no compatible platforms stays unavailable', async ({ page }) => {
  await page.route(configUrl, (route) => route.fulfill({ json: { ...config, platforms: {} } }))
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('no compatible platforms')
  await expect(page.locator('#platforms').getByRole('button')).toHaveCount(0)
})
for (const [platform, name] of [
  ['google', 'Google'],
  ['x', 'X'],
  ['github', 'GitHub'],
]) {
  for (const blocked of [false, true]) {
    test(`${name} popup launch${blocked ? ' through the native anchor' : ''}, cancellation and retry`, async ({
      page,
      context,
    }) => {
      if (blocked)
        await page.addInitScript(() => {
          window.open = () => null
        })
      await page.route(configUrl, (route) =>
        route.fulfill({
          json: {
            ...config,
            platforms: {
              ...config.platforms,
              x: { clientId: 'test-client', ceremonyVersions: [1] },
              github: { clientId: 'test-client', ceremonyVersions: [1] },
            },
          },
        }),
      )
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
      const launch = page.getByRole('button', { name, exact: true })
      if (platform === 'google') await launch.press(blocked ? 'Space' : 'Enter')
      else await launch.click()
      const popup = await opened
      await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
      expect(new URLSearchParams(new URL(popup.url()).hash.slice(1)).get('platformId')).toBe(
        platform,
      )
      await expect(page.locator('#platforms').getByRole('button')).toHaveCount(3)
      for (const button of await page.locator('#platforms').getByRole('button').all())
        await expect(button).toHaveAttribute('aria-disabled', 'true')
      const rows = page.locator('#history tr')
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByRole('cell').nth(1)).toHaveText(name)
      await expect(rows.first().getByRole('cell').nth(2)).toHaveText('Running')
      await expect(page.getByRole('button', { name: 'Cancel ceremony' })).toBeEnabled()
      await page.getByRole('button', { name: 'Cancel ceremony' }).click()
      await expect(page.locator('#result')).toHaveText('Ceremony cancelled.')
      // This inert fallback has no handle or authenticated carrier to receive closure.
      if (blocked) await popup.close()
      else await expect.poll(() => popup.isClosed()).toBe(true)
      for (const button of await page.locator('#platforms').getByRole('button').all())
        await expect(button).toHaveAttribute('aria-disabled', 'false')
      expect(await page.evaluate(() => window.result)).toEqual({ status: 'cancelled' })
      await expect(rows.first().getByRole('cell').nth(2)).toHaveText('Cancelled')
      await expect(rows.first().getByRole('cell').nth(3)).toHaveText(/^\d+\.\d s$/)
      if (platform === 'google' && !blocked) {
        const secondOpened = page.waitForEvent('popup')
        await page.getByRole('button', { name: 'X', exact: true }).click()
        const secondPopup = await secondOpened
        await expect(rows).toHaveCount(2)
        await expect(rows.first().getByRole('cell').nth(1)).toHaveText('X')
        await expect(rows.first().getByRole('cell').nth(2)).toHaveText('Running')
        await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText('Google')
        await expect(rows.nth(1).getByRole('cell').nth(2)).toHaveText('Cancelled')
        await page.getByRole('button', { name: 'Cancel ceremony' }).click()
        await expect(rows.first().getByRole('cell').nth(2)).toHaveText('Cancelled')
        await expect.poll(() => secondPopup.isClosed()).toBe(true)
        await page.reload()
        await expect(rows).toHaveCount(0)
        await expect(page.locator('#history-empty')).toBeVisible()
      }
    })
  }
}

for (const blocked of [false, true]) {
  test(`failure keeps the popup open${blocked ? ' through the native anchor' : ''} until manually closed`, async ({
    page,
    context,
  }) => {
    if (blocked)
      await page.addInitScript(() => {
        window.open = () => null
      })
    await page.route(configUrl, (route) => route.fulfill({ json: config }))
    await context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Failure test boundary</title>',
      }),
    )
    await page.goto('/')
    const launch = page.getByRole('button', { name: 'Google', exact: true })
    await expect(launch).toHaveAttribute('aria-disabled', 'false')
    const opened = page.waitForEvent('popup')
    await launch.click()
    const popup = await opened
    await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
    // A synthetic failure over the actual popup transport; no OAuth or proof is simulated.
    // Serve the real package at the popup origin, avoiding cross-origin dev-server imports.
    await context.route(`${ccdp}/popup-test/**`, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: readFileSync(
          new URL(
            new URL(route.request().url()).pathname.slice('/popup-test/'.length),
            import.meta.resolve('@libid/popup'),
          ),
        ),
      }),
    )
    const popupModule = `${ccdp}/popup-test/index.js`
    await popup.evaluate(async (moduleUrl) => {
      const { PopupConnection, PopupWindow } = await import(/* @vite-ignore */ moduleUrl)
      const id = new URLSearchParams(location.hash.slice(1)).get('ceremonyId')
      const connection = PopupConnection.accept(
        PopupWindow.current(location.hash, { scope: '/' }),
        {
          connectionId: id,
          allowedApplicationOrigins: ['https://localhost:4692'],
        },
      )
      await connection.ready
      connection.send({
        type: 'abort-ceremony',
        code: 'prover-execution',
        reason: 'Unable to complete the platform proof.',
      })
    }, popupModule)
    await expect(page.getByRole('status')).toContainText('popup is open for inspection')
    await expect(page.getByRole('button', { name: 'Cancel ceremony' })).toBeDisabled()
    await expect(page.locator('#history')).toContainText('Failed (prover-execution)')
    expect(popup.isClosed()).toBe(false)
    await expect(launch).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('button', { name: 'Close popup' }).click()
    await expect.poll(() => popup.isClosed()).toBe(true)
    await expect(page.getByRole('status')).toHaveText('Popup closed. Start a fresh attempt.')
    await expect(launch).toHaveAttribute('aria-disabled', 'false')
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
