import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const configUrl = 'http://localhost:4682/api/v1/ceremony/config'
const ccdp = 'http://localhost:4683'
const config = {
  callbackPath: '/auth/callback',
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
  await expect(page.locator('dl')).toContainText('http://localhost:4687')
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
      await expect(rows.first().getByRole('cell').nth(4)).toHaveText('—')
      await expect(rows.first().locator('.operation-timings li')).toContainText('Prefetch dispatch')
      await expect(rows.first().locator('.operation-timings li')).toContainText('(interrupted)')
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
          allowedApplicationOrigins: ['http://localhost:4692'],
        },
      )
      await connection.ready
      connection.send({
        type: 'abort',
        event: 'identity-fetch',
        message: '<img src=x onerror=alert(1)> Invalid GitHub id',
      })
    }, popupModule)
    await expect(page.getByRole('status')).toContainText('popup is open for inspection')
    await expect(page.getByRole('button', { name: 'Cancel ceremony' })).toBeDisabled()
    await expect(page.locator('#history')).toContainText('Failed (identity-fetch)')
    expect(popup.isClosed()).toBe(false)
    await expect(page.locator('#result')).toHaveText(
      '<img src=x onerror=alert(1)> Invalid GitHub id',
    )
    await expect(page.locator('#result img')).toHaveCount(0)
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
  const privateConfig = join(root, `.env.${basename(directory)}`)
  writeFileSync(file, '{}')
  writeFileSync(privateConfig, 'PRIVATE_TEST_VALUE=fixture', { flag: 'wx' })
  try {
    for (const path of [privateConfig, file]) {
      const response = await request.get(`/@fs${path}`)
      expect(response.status(), path).toBe(403)
    }
  } finally {
    rmSync(privateConfig)
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const [platform, name, outcome = 'failed'] of [
  ['google', 'Google'],
  ['x', 'X'],
  ['github', 'GitHub'],
  ['google', 'Google', 'success'],
]) {
  test(`${name} operation timings preserve occurrences and freeze on ${outcome}`, async ({
    page,
    context,
  }) => {
    await page.route(configUrl, (route) =>
      route.fulfill({
        json: {
          ...config,
          platforms: { [platform]: { clientId: 'client', ceremonyVersions: [1] } },
        },
      }),
    )
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
    const document = (
      prover: boolean,
    ) => `<!doctype html><title>Event transport fixture</title><script type="module">
      import { PopupConnection, PopupWindow } from '${ccdp}/popup-test/index.js';
      const id = new URLSearchParams(location.hash.slice(1)).get('ceremonyId');
      const connection = PopupConnection.accept(PopupWindow.current(location.hash, { scope: '/' }), {
        connectionId: id, allowedApplicationOrigins: ['http://localhost:4692'],
      });
      ${prover ? `connection.on({ type: 'prove-identity', decode: value => value }, () => { window.requested = true });` : ''}
      await connection.ready;
      ${prover ? 'window.eventConnection = connection;' : "connection.send({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: performance.timeOrigin + performance.now() });"}
    </script>`
    await context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: document(false) }),
    )
    await context.route(`${ccdp}/event-test**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: document(true) }),
    )
    await context.route(/https:\/\/(accounts\.google\.com|x\.com|github\.com)\//, (route) => {
      const id = new URL(route.request().url()).searchParams.get('state')!.slice(3)
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>window.returnUrl = ${JSON.stringify(`${ccdp}/event-test#ceremonyId=${id}`)}</script>`,
      })
    })
    await page.clock.install()
    await page.goto('/')
    const opened = page.waitForEvent('popup')
    await page.getByRole('button', { name, exact: true }).click()
    const popup = await opened
    await popup.waitForFunction(() => !!(window as unknown as { returnUrl?: string }).returnUrl)
    await page.clock.runFor(5000)
    await popup.evaluate(() =>
      location.replace((window as unknown as { returnUrl: string }).returnUrl),
    )
    await popup.waitForFunction(
      () => !!(window as unknown as { eventConnection?: unknown }).eventConnection,
    )
    const returnedAt = await page.evaluate(() => performance.timeOrigin + performance.now())
    // Explicit occurrence times test transport delay independently of the app's delivery clock.
    const send = async (event: string, phase: 'started' | 'finished', offset: number) =>
      popup.evaluate(
        ({ event, phase, timestamp }) => {
          ;(
            window as unknown as { eventConnection: { send(value: unknown): void } }
          ).eventConnection.send({ type: 'event', event, phase, timestamp })
        },
        { event, phase, timestamp: returnedAt + offset },
      )
    await send('authorization', 'finished', 0)
    await send('prover', 'started', 10)
    await popup.waitForFunction(() => (window as unknown as { requested?: boolean }).requested)
    await send('zk-proof-preparation', 'started', 20)
    await expect(page.getByRole('status')).toHaveText('Preparing your identity proof')
    if (platform !== 'google') {
      const token = platform === 'x' ? 'token-fetch' : 'token-attestation'
      await send(token, 'started', 20)
      await send(token, 'finished', 1000)
      await send('identity-fetch', 'started', 1000)
      await send('identity-fetch', 'finished', 2000)
      await send('identity-attestation', 'started', 2000)
    }
    await send('zk-proof-generation', 'started', 2500)
    await send('zk-proof-preparation', 'finished', 2600)
    await send('zk-proof-generation', 'finished', 3500)
    await expect(page.getByRole('status')).toHaveText('Creating your identity proof with ZK')
    await expect(page.locator('.operation-timings')).toContainText('ZK proof generation · 1.0 s')
    await expect(page.locator('#history tr').first().getByRole('cell').nth(2)).toHaveText('Running')
    // This synthetic delivery checks UI only; no browser proof generation is claimed.
    await page.clock.runFor(4500)
    if (platform !== 'google') await send('identity-attestation', 'finished', 4000)
    await popup.evaluate((success) => {
      const connection = (window as unknown as { eventConnection: { send(value: unknown): void } })
        .eventConnection
      connection.send(
        success
          ? {
              type: 'identity-proof',
              identity: {
                platformId: 'google',
                oauthClientId: 'client',
                userId: '1',
                userName: 'a@b.c',
              },
              proof: {
                identityProof: new Uint8Array([1]),
                tokenExpiresAt: 42,
                signingKeyModulus: new Uint8Array(256),
              },
            }
          : { type: 'abort', event: 'identity-fetch', message: 'Invalid GitHub id' },
      )
    }, outcome === 'success')
    await expect(page.locator('#history')).toContainText(
      outcome === 'success' ? 'Proof received' : 'Failed (identity-fetch)',
    )
    const timings = page.locator('.operation-timings li')
    await expect(timings).toHaveCount(platform === 'google' ? 5 : 8)
    const cells = page.locator('#history tr').first().getByRole('cell')
    const total = Number.parseFloat((await cells.nth(3).textContent())!)
    const postConsent = Number.parseFloat((await cells.nth(4).textContent())!)
    expect(postConsent).toBeGreaterThanOrEqual(4.5)
    expect(total - postConsent).toBeGreaterThanOrEqual(4.9)
    const row = await page.locator('#history').textContent()
    await page.clock.runFor(2000)
    await expect(page.locator('#history')).toHaveText(row!)
  })
}
