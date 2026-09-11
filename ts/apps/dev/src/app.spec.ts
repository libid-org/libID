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
      await expect(rows.first().locator('.stage-timings li')).toContainText('Opening popup')
      await expect(rows.first().locator('.stage-timings li')).toContainText('(cancelled)')
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

for (const [platform, name, outcome = 'denied'] of [
  ['google', 'Google'],
  ['x', 'X'],
  ['github', 'GitHub'],
  ['google', 'Google', 'success'],
]) {
  test(`${name} stage timings survive overlapping progress and freeze on ${outcome}`, async ({
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
    ) => `<!doctype html><title>Stage transport fixture</title><script type="module">
      import { PopupConnection, PopupWindow } from '${ccdp}/popup-test/index.js';
      const id = new URLSearchParams(location.hash.slice(1)).get('ceremonyId');
      const connection = PopupConnection.accept(PopupWindow.current(location.hash, { scope: '/' }), {
        connectionId: id, allowedApplicationOrigins: ['http://localhost:4692'],
      });
      ${
        prover
          ? `
        connection.on({ type: 'app-start-prover', decode: value => value }, request => {
          connection.send({ type: 'prover-notify-event', stage: request.platformId === 'google' ? 'proof-preparation' : 'code-exchange', timestamp: 1 });
          window.stageConnection = connection;
        });
      `
          : ''
      }
      await connection.ready;
      connection.send({ type: '${prover ? 'callback-ready' : 'prefetch-ready'}' });
      connection.send({ type: '${prover ? 'prover-ready' : 'prefetch-started'}' });
    </script>`
    await context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: document(false) }),
    )
    await context.route(`${ccdp}/stage-test**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: document(true) }),
    )
    // Simulated OAuth navigation and advisory events over the actual popup package.
    // This test produces no tokens, attestations or proofs.
    await context.route(/https:\/\/(accounts\.google\.com|x\.com|github\.com)\//, (route) => {
      const id = new URL(route.request().url()).searchParams.get('state')!.slice(3)
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>window.returnUrl = ${JSON.stringify(`${ccdp}/stage-test#ceremonyId=${id}`)}</script>`,
      })
    })
    await page.clock.install()
    await page.goto('/')
    const opened = page.waitForEvent('popup')
    await page.getByRole('button', { name, exact: true }).click()
    const popup = await opened
    await popup.waitForFunction(() => !!(window as unknown as { returnUrl?: string }).returnUrl)
    // Advance consent time only after navigation settles; the return has not started.
    await page.clock.runFor(5000)
    await popup.evaluate(() =>
      location.replace((window as unknown as { returnUrl: string }).returnUrl),
    )
    await popup.waitForFunction(
      () => !!(window as unknown as { stageConnection?: unknown }).stageConnection,
    )
    const stages =
      platform === 'google'
        ? ['proof-generation']
        : ['identity-fetch', 'proof-preparation', 'proof-generation']
    for (const stage of stages) {
      await page.clock.runFor(1000)
      await popup.evaluate((stage) => {
        const connection = (
          window as unknown as { stageConnection: { send(value: unknown): void } }
        ).stageConnection
        connection.send({ type: 'prover-notify-event', stage, timestamp: 1 })
        connection.send({
          type: 'prover-notify-event',
          timestamp: 1,
          platformStep: {
            code: 'proof-backend-initialization',
            label: 'Concurrent backend work',
            status: 'completed',
            progress: 0.5,
          },
        })
      }, stage)
      await expect(page.getByRole('status')).not.toContainText('Concurrent backend work')
      await expect(page.locator('.stage-timings li').last()).toContainText(
        stage === 'identity-fetch'
          ? 'Fetching identity via notary'
          : stage === 'proof-preparation'
            ? 'Setting up ZK prover'
            : 'Generating proof',
      )
    }
    // Finishing the ZK backend must not finish the complete proof's UI interval.
    await popup.evaluate(() => {
      ;(
        window as unknown as { stageConnection: { send(value: unknown): void } }
      ).stageConnection.send({
        type: 'prover-notify-event',
        timestamp: 1,
        platformStep: {
          code: 'proof-backend-destroy',
          label: 'Finishing ZK proof',
          status: 'completed',
          progress: 0.9,
        },
      })
    })
    await page.clock.runFor(1000)
    await expect(page.locator('.stage-timings li').last()).toContainText('Generating proof')
    await popup.evaluate((success) => {
      const connection = (window as unknown as { stageConnection: { send(value: unknown): void } })
        .stageConnection
      // Synthetic delivery tests UI completion only, never cryptographic qualification.
      connection.send(
        success
          ? {
              type: 'prover-identity-proof',
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
          : { type: 'cancel-ceremony' },
      )
    }, outcome === 'success')
    await expect(page.locator('#history')).toContainText(
      outcome === 'success' ? 'Proof received' : 'Denied',
    )
    const timings = page.locator('.stage-timings li')
    await expect(timings).toHaveCount(platform === 'google' ? 4 : 6)
    expect(
      (await timings.allTextContents()).slice(0, 2).map((text) => text.split(' · ')[0]),
    ).toEqual(['Popup opened', 'User authorised'])
    expect(
      (await timings.allTextContents()).slice(2, -1).map((text) => text.split(' · ')[0]),
    ).toEqual(
      platform === 'google'
        ? ['ZK prover ready']
        : ['Token fetched via notary', 'Identity fetched via notary', 'ZK prover ready'],
    )
    for (const text of await timings.allTextContents())
      expect(text).toMatch(/ · \d+\.\d s(?: \(denied\))?$/)
    for (const text of (await timings.allTextContents()).slice(2)) {
      const seconds = Number(/ · ([\d.]+) s/.exec(text)![1])
      expect(seconds).toBeGreaterThanOrEqual(1)
      expect(seconds).toBeLessThan(3)
    }
    await expect(timings.last()).toContainText(
      outcome === 'success' ? 'Proof generated' : '(denied)',
    )
    await expect(timings.last()).not.toContainText('Complete ·')
    const cells = page.locator('#history tr').first().getByRole('cell')
    const total = Number.parseFloat((await cells.nth(3).textContent())!)
    const postConsent = Number.parseFloat((await cells.nth(4).textContent())!)
    expect(postConsent).toBeGreaterThanOrEqual(platform === 'google' ? 2 : 4)
    expect(total - postConsent).toBeGreaterThanOrEqual(4.9)
    const row = await page.locator('#history').textContent()
    await page.clock.runFor(2000)
    await expect(page.locator('#history')).toHaveText(row!)
  })
}
