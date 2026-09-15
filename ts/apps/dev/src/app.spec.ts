import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, expect, test } from '@playwright/test'

const configUrl = 'http://localhost:4682/api/v1/ceremony/config'
const ccdp = 'http://localhost:4683'
const config = {
  ccdpOrigin: ccdp,
  platforms: {
    google: { clientId: '407408718192.apps.googleusercontent.com', ceremonyVersions: [1] },
    github: { clientId: 'test-client', ceremonyVersions: [2], clientCredential: 'fixture-public' },
  },
}
// Real popup transport with synthetic ceremony documents; no OAuth or proof qualification.
async function servePopup(context: BrowserContext) {
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
  return `${ccdp}/popup-test/index.js`
}

async function serveCeremony(context: BrowserContext) {
  const popupModule = await servePopup(context)
  const document = (
    prover: boolean,
  ) => `<!doctype html><title>Event transport fixture</title><script type="module">
      import { PopupConnection, PopupWindow } from '${popupModule}';
      const id = new URLSearchParams(location.hash.slice(1)).get('ceremonyId');
      const connection = PopupConnection.accept(PopupWindow.current(location.hash, { scope: '/' }), {
        connectionId: id, allowedApplicationOrigins: ['http://localhost:4692'],
      });
      ${prover ? `connection.on({ type: 'prove-identity', decode: value => value }, value => { window.requested = true; window.proveIdentity = value });` : ''}
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
  await expect(page.getByRole('button', { name: 'Google', exact: true })).toBeEnabled()
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
    test(`${name} popup launch${blocked ? ' through the native anchor' : ''}, closure and retry`, async ({
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
              github: {
                clientId: 'test-client',
                ceremonyVersions: [1],
                clientCredential: 'fixture-public',
              },
            },
          },
        }),
      )
      // Only transport setup is exercised here. No simulated proof delivery or OAuth consent.
      const popupModule = await servePopup(context)
      await context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>Prefetch test boundary</title><script type="module">
            import { PopupConnection, PopupWindow } from '${popupModule}';
            ${blocked ? 'await new Promise(resolve => { window.authenticate = resolve });' : ''}
            const connection = PopupConnection.accept(PopupWindow.current(), {
              connectionId: new URLSearchParams(location.hash.slice(1)).get('ceremonyId'),
              allowedApplicationOrigins: ['http://localhost:4692'],
            });
            await connection.ready;
            window.connected = true;
          </script>`,
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
      if (blocked) {
        await expect(
          page.locator('#history tr').first().getByRole('button', { name: 'Close' }),
        ).toBeDisabled()
        await popup.waitForFunction(
          () =>
            typeof (window as unknown as { authenticate?: unknown }).authenticate === 'function',
        )
        await popup.evaluate(() => (window as unknown as { authenticate(): void }).authenticate())
      }
      await popup.waitForFunction(() => (window as unknown as { connected: boolean }).connected)
      expect(new URLSearchParams(new URL(popup.url()).hash.slice(1)).get('platformId')).toBe(
        platform,
      )
      await expect(page.locator('#platforms').getByRole('button')).toHaveCount(3)
      for (const button of await page.locator('#platforms').getByRole('button').all())
        await expect(button).toBeEnabled()
      const rows = page.locator('#history tr')
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByRole('cell').nth(1)).toHaveText(name)
      await expect(rows.first().locator('.run-outcome')).toHaveText('Running')
      await expect(
        page.locator('#history tr').first().getByRole('button', { name: 'Close' }),
      ).toBeEnabled()
      await page.locator('#history tr').first().getByRole('button', { name: 'Close' }).click()
      await expect(page.locator('#history tr').first().locator('.run-status')).toHaveText(
        'Popup connection ended',
      )
      await expect.poll(() => popup.isClosed()).toBe(true)
      for (const button of await page.locator('#platforms').getByRole('button').all())
        await expect(button).toBeEnabled()
      expect(await page.evaluate(() => [...window.results.values()])).toEqual([
        { status: 'closed' },
      ])
      await expect(rows.first().locator('.run-outcome')).toHaveText('Interrupted')
      await expect(rows.first().getByRole('cell').nth(3)).toHaveText(/^\d+\.\d s$/)
      await expect(rows.first().getByRole('cell').nth(4)).toHaveText('—')
      await expect(rows.first().locator('.operation-timings li')).toContainText('Prefetch dispatch')
      await expect(rows.first().locator('.operation-timings li')).toContainText('(interrupted)')
      if (platform === 'google' && !blocked) {
        const secondOpened = page.waitForEvent('popup')
        await page.getByRole('button', { name: 'X', exact: true }).click()
        const secondPopup = await secondOpened
        await secondPopup.waitForFunction(
          () => (window as unknown as { connected: boolean }).connected,
        )
        await expect(rows).toHaveCount(2)
        await expect(rows.first().getByRole('cell').nth(1)).toHaveText('X')
        await expect(rows.first().locator('.run-outcome')).toHaveText('Running')
        await expect(rows.nth(1).getByRole('cell').nth(1)).toHaveText('Google')
        await expect(rows.nth(1).locator('.run-outcome')).toHaveText('Interrupted')
        await page.locator('#history tr').first().getByRole('button', { name: 'Close' }).click()
        await expect(rows.first().locator('.run-outcome')).toHaveText('Interrupted')
        await expect.poll(() => secondPopup.isClosed()).toBe(true)
        await page.reload()
        await expect(rows).toHaveCount(0)
        await expect(page.locator('#history-empty')).toBeVisible()
      }
    })
  }
}

for (const blocked of [false, true]) {
  for (const transportFailure of [false, true]) {
    test(`${transportFailure ? 'transport' : 'ceremony'} failure keeps the popup open${blocked ? ' through the native anchor' : ''} until manually closed`, async ({
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
      await expect(launch).toBeEnabled()
      const opened = page.waitForEvent('popup')
      await launch.click()
      const popup = await opened
      await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
      // A synthetic failure over the actual popup transport; no OAuth or proof is simulated.
      // Serve the real package at the popup origin, avoiding cross-origin dev-server imports.
      const popupModule = await servePopup(context)
      await popup.evaluate(
        async ({ moduleUrl, transportFailure }) => {
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
          connection.send(
            transportFailure
              ? { type: 'event' }
              : {
                  type: 'ceremony-failed',
                  event: 'identity-fetch',
                  message: '<img src=x onerror=alert(1)> Invalid GitHub id',
                },
          )
        },
        { moduleUrl: popupModule, transportFailure },
      )
      if (transportFailure) {
        await expect(page.locator('.run-actions')).toBeEmpty()
        await expect(page.locator('.run-outcome')).toHaveText('Failed (prefetch-dispatch)')
        expect(popup.isClosed()).toBe(false)
        await popup.close()
        return
      }
      await expect(page.locator('.run-status')).toContainText('Invalid GitHub id')
      await expect(
        page.locator('#history tr').first().getByRole('button', { name: 'Close' }),
      ).toBeEnabled()
      await expect(page.locator('#history')).toContainText('Failed (identity-fetch)')
      expect(popup.isClosed()).toBe(false)
      await expect(page.locator('#history tr').first().locator('.run-status')).toHaveText(
        '<img src=x onerror=alert(1)> Invalid GitHub id',
      )
      await expect(page.locator('.run-status img')).toHaveCount(0)
      await expect(launch).toBeEnabled()
      await page.locator('#history tr').first().getByRole('button', { name: 'Close' }).click()
      await expect.poll(() => popup.isClosed()).toBe(true)
      await expect(page.locator('#history')).toContainText('Failed (identity-fetch)')
      await expect(launch).toBeEnabled()
    })
  }
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

for (const [platform, name, outcome = 'failed', fallback = false] of [
  ['google', 'Google'],
  ['x', 'X'],
  ['github', 'GitHub'],
  ['google', 'Google', 'success'],
  ['google', 'Google', 'denied'],
  ['google', 'Google', 'success', true],
  ['google', 'Google', 'failed', true],
] as const) {
  test(`${name} operation timings${fallback ? ' with fallback' : ''} preserve occurrences and freeze on ${outcome}`, async ({
    page,
    context,
  }) => {
    await page.route(configUrl, (route) =>
      route.fulfill({
        json: {
          ...config,
          platforms: {
            [platform]: {
              clientId: 'client',
              ceremonyVersions: [1],
              ...(platform === 'github' ? { clientCredential: 'bridge-provided' } : {}),
            },
          },
        },
      }),
    )
    await serveCeremony(context)
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
    const send = async (event: string, phase: 'started' | 'finished' | undefined, offset: number) =>
      popup.evaluate(
        ({ event, phase, timestamp }) => {
          ;(
            window as unknown as { eventConnection: { send(value: unknown): void } }
          ).eventConnection.send({ type: 'event', event, ...(phase ? { phase } : {}), timestamp })
        },
        { event, phase, timestamp: returnedAt + offset },
      )
    await send('authorization', 'finished', 0)
    if (fallback) {
      await page.clock.runFor(1000)
      await send('prover-fallback', undefined, 100)
      await expect(page.locator('.operation-timings')).toContainText('Prover fallback')
      await page.clock.runFor(1500)
      await expect(page.locator('.operation-timings')).toContainText(
        /Prover fallback · \d+\.\d s \(running\)/,
      )
    }
    await send('prover', 'started', fallback ? 710 : 10)
    const fallbackTiming = page
      .locator('.operation-timings li')
      .filter({ hasText: 'Prover fallback' })
    if (fallback) await expect(fallbackTiming).toHaveText('Prover fallback · 0.6 s')
    else await expect(fallbackTiming).toHaveCount(0)
    await popup.waitForFunction(() => (window as unknown as { requested?: boolean }).requested)
    if (outcome === 'denied') {
      await popup.evaluate(() => {
        ;(
          window as unknown as { eventConnection: { send(value: unknown): void } }
        ).eventConnection.send({ type: 'user-denied' })
      })
      await expect.poll(() => popup.isClosed()).toBe(true)
      await expect(page.locator('.run-outcome')).toHaveText('Denied')
      await expect(page.locator('.run-status')).toHaveText('Authorization was denied.')
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
      const row = await page.locator('#history').textContent()
      await page.clock.runFor(2000)
      await expect(page.locator('#history')).toHaveText(row!)
      return
    }
    await send('zk-proof-preparation', 'started', fallback ? 720 : 20)
    await expect(page.locator('.run-status')).toHaveText('Preparing your identity proof')
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
    await expect(page.locator('.run-status')).toHaveText('Creating your identity proof with ZK')
    await expect(page.locator('.operation-timings')).toContainText('ZK proof generation · 1.0 s')
    await expect(page.locator('#history tr').first().locator('.run-outcome')).toHaveText('Running')
    // This synthetic delivery checks UI only; no browser proof generation is claimed.
    await page.clock.runFor(4500)
    if (platform !== 'google') await send('identity-attestation', 'finished', 4000)
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
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
          : { type: 'ceremony-failed', event: 'identity-fetch', message: 'Invalid GitHub id' },
      )
    }, outcome === 'success')
    await expect(page.locator('#history')).toContainText(
      outcome === 'success' ? 'Proof received' : 'Failed (identity-fetch)',
    )
    // The app closes success without waiting for an application timer.
    if (outcome === 'success') await expect.poll(() => popup.isClosed()).toBe(true)
    else expect(popup.isClosed()).toBe(false)
    const timings = page.locator('.operation-timings li')
    await expect(timings).toHaveCount((platform === 'google' ? 5 : 8) + Number(fallback))
    if (fallback) await expect(fallbackTiming).toHaveText('Prover fallback · 0.6 s')
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

for (const blocked of [false, true]) {
  test(`concurrent runs keep controls, stages and results separate${blocked ? ' with native anchors' : ''}`, async ({
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
            google: { clientId: 'client', ceremonyVersions: [1] },
            x: { clientId: 'client', ceremonyVersions: [1] },
          },
        },
      }),
    )
    await serveCeremony(context)
    await page.goto('/')
    await expect(page.locator('#status')).toContainText('Ready.')

    async function launch(name: string) {
      const opened = page.waitForEvent('popup')
      await page.getByRole('button', { name, exact: true }).click()
      const popup = await opened
      await popup.waitForFunction(() => !!(window as unknown as { returnUrl?: string }).returnUrl)
      const id = (await page.locator('#history tr').first().getAttribute('data-ceremony-id'))!
      const row = page.locator(`[data-ceremony-id="${id}"]`)
      return { popup, id, row }
    }
    const first = await launch('Google')
    const second = await launch('Google')
    const third = await launch('X')
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
    await expect(page.locator('#history tr')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(3)
    for (const run of [first, second, third]) {
      expect(run.popup.isClosed()).toBe(false)
      await run.popup.evaluate(() =>
        location.replace((window as unknown as { returnUrl: string }).returnUrl),
      )
      await run.popup.waitForFunction(
        () => !!(window as unknown as { eventConnection?: unknown }).eventConnection,
      )
      await run.popup.evaluate(() => {
        const connection = (
          window as unknown as { eventConnection: { send(value: unknown): void } }
        ).eventConnection
        const timestamp = performance.timeOrigin + performance.now()
        connection.send({ type: 'event', event: 'authorization', phase: 'finished', timestamp })
        connection.send({ type: 'event', event: 'prover', phase: 'started', timestamp })
      })
      await run.popup.waitForFunction(
        () => (window as unknown as { requested?: boolean }).requested,
      )
    }
    for (const [run, event] of [
      [first, 'zk-proof-generation'],
      [third, 'token-fetch'],
    ] as const)
      await run.popup.evaluate((event) => {
        const connection = (
          window as unknown as { eventConnection: { send(value: unknown): void } }
        ).eventConnection
        connection.send({
          type: 'event',
          event,
          phase: 'started',
          timestamp: performance.timeOrigin + performance.now(),
        })
      }, event)
    await expect(first.row.locator('.run-status')).toHaveText(
      'Creating your identity proof with ZK',
    )
    await expect(second.row.locator('.run-status')).toHaveText('Preparing your identity proof')
    await expect(third.row.locator('.run-status')).toHaveText('Notarizing your identity data')
    // Complete the later Google run first; this is synthetic UI delivery, not a generated proof.
    await second.popup.evaluate(() => {
      const connection = (window as unknown as { eventConnection: { send(value: unknown): void } })
        .eventConnection
      connection.send({
        type: 'identity-proof',
        identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
        proof: {
          identityProof: new Uint8Array([1]),
          tokenExpiresAt: 42,
          signingKeyModulus: new Uint8Array(256),
        },
      })
    })
    await expect.poll(() => second.popup.isClosed()).toBe(true)
    await expect(second.row.locator('.run-outcome')).toHaveText('Proof received')
    await expect(first.row.locator('.run-outcome')).toHaveText('Running')
    await expect(third.row.locator('.run-outcome')).toHaveText('Running')
    expect(first.popup.isClosed()).toBe(false)
    expect(third.popup.isClosed()).toBe(false)

    await first.row.getByRole('button', { name: 'Close' }).click()
    await expect(first.row.locator('.run-outcome')).toHaveText('Interrupted')
    await expect.poll(() => first.popup.isClosed()).toBe(true)
    await expect(third.row.getByRole('button', { name: 'Close' })).toBeEnabled()
    expect(third.popup.isClosed()).toBe(false)
    await third.popup.evaluate(() => {
      const connection = (window as unknown as { eventConnection: { send(value: unknown): void } })
        .eventConnection
      connection.send({
        type: 'ceremony-failed',
        event: 'identity-fetch',
        message: 'Identity request failed',
      })
    })
    await expect(third.row.locator('.run-outcome')).toHaveText('Failed (identity-fetch)')
    expect(third.popup.isClosed()).toBe(false)
    expect(
      await page.evaluate(() =>
        Object.fromEntries([...window.results].map(([id, result]) => [id, result.status])),
      ),
    ).toEqual({
      [first.id]: 'failed',
      [second.id]: 'accepted',
      [third.id]: 'failed',
    })

    const fourth = await launch('Google')
    await third.popup.close()
    await page.evaluate(() => {
      const encode = TextEncoder.prototype.encode
      TextEncoder.prototype.encode = () => {
        TextEncoder.prototype.encode = encode
        throw new Error('Input preparation failed after opening the popup')
      }
    })
    const failedPopupOpened = blocked ? undefined : page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Google', exact: true }).click()
    const failedPopup = await failedPopupOpened
    await expect(page.locator('#history tr').first().locator('.run-outcome')).toHaveText(
      'Failed to start',
    )
    if (failedPopup) {
      expect(failedPopup.isClosed()).toBe(false)
      await page.locator('#history tr').first().getByRole('button', { name: 'Close' }).click()
      await expect.poll(() => failedPopup.isClosed()).toBe(true)
      await expect(page.locator('#history tr').first().locator('.run-outcome')).toHaveText(
        'Failed to start',
      )
    }
    await expect(fourth.row.locator('.run-outcome')).toHaveText('Running')
    expect(fourth.popup.isClosed()).toBe(false)
    await fourth.row.getByRole('button', { name: 'Close' }).click()
    await expect(fourth.row.locator('.run-outcome')).toHaveText('Interrupted')
    await expect.poll(() => fourth.popup.isClosed()).toBe(true)
    await expect(fourth.row.locator('.run-outcome')).toHaveText('Interrupted')
    expect(await page.evaluate((id) => window.results.get(id)?.status, fourth.id)).toBe('closed')
    await expect(second.row.locator('.run-outcome')).toHaveText('Proof received')
  })
}

for (const credential of ['bridge-provided', undefined, null, '']) {
  test(`validates the Bridge client credential: ${JSON.stringify(credential)}`, async ({
    page,
  }) => {
    await page.route(configUrl, (route) =>
      route.fulfill({
        json: {
          ...config,
          platforms: {
            github: {
              clientId: 'test-client',
              ceremonyVersions: [1],
              clientCredential: credential,
            },
          },
        },
      }),
    )
    await page.goto('/')
    if (credential)
      await expect(page.getByRole('button', { name: 'GitHub', exact: true })).toBeEnabled()
    else await expect(page.getByRole('status')).toContainText('Could not load Bridge configuration')
  })
}

for (const blocked of [false, true])
  test(`GitHub consent-page closure fails the run${blocked ? ' after native-anchor launch' : ''}`, async ({
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
            github: {
              ...config.platforms.github,
              ceremonyVersions: [1],
              clientCredential: 'test-public-credential',
            },
          },
        },
      }),
    )
    await serveCeremony(context)
    await page.goto('/')
    await expect(page.getByRole('status')).toContainText('Ready.')
    const opened = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'GitHub', exact: true }).click()
    const popup = await opened
    await expect(popup).toHaveURL(/^https:\/\/github\.com\/login\/oauth\/authorize/)
    await popup.waitForFunction(() => 'returnUrl' in window)
    await popup.close()
    const row = page.locator('#history tr').first()
    await expect(row.locator('.run-outcome')).toHaveText('Failed (authorization)')
    await expect(row.locator('.run-status')).toContainText('closed or isolated')
    await expect(row.locator('.run-actions')).toBeEmpty()
    await expect
      .poll(() => page.evaluate(() => [...window.results.values()]))
      .toEqual([{ status: 'failed' }])
  })
