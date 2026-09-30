import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import {
  bundled,
  ccdp,
  closeButton,
  closeFromPopup,
  closeRun,
  config,
  configUrl,
  event,
  expectClosed,
  expectFrozen,
  expectLaunchesEnabled,
  expectRun,
  fixtureDocument,
  identityFetchFailure,
  launch,
  launchButton,
  launchButtons,
  launchRun,
  newestRun,
  openApp,
  results,
  returnToProver,
  runs,
  send,
  sendProof,
  serveBridge,
  serveCeremony,
  servePopup,
  servePrefetch,
  serveVersions,
  timing,
  timingDetails,
  versionsUrl,
  waitForFixture,
} from './app.fixtures.ts'

const platforms = [
  ['google', 'Google'],
  ['x', 'X'],
  ['github', 'GitHub'],
] as const

test('unavailable Bridge disables launch; reload loads compatible platforms', async ({ page }) => {
  let available = false
  await serveVersions(page)
  await page.route(configUrl, (route) =>
    available
      ? route.fulfill({ json: config })
      : route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Could not load Bridge configuration')
  await expect(launchButtons(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0)
  available = true
  await page.reload()
  await expect(page.getByRole('status')).toContainText('Ready.')
  await expect(page.locator('dl')).toContainText('http://localhost:4687')
  await expect(page.locator('dl')).not.toContainText('Ledger')
  await expect(launchButtons(page)).toHaveText(['Google'])
  await expect(launchButton(page, 'Google')).toBeEnabled()
})

for (const { name, platforms, versions } of [
  { name: 'no Bridge registrations', platforms: {}, versions: bundled },
  { name: 'empty Distribution catalog', platforms: config.platforms, versions: {} },
  { name: 'no common version', platforms: config.platforms, versions: { x: [1], github: [2] } },
])
  test(`${name} stays unavailable`, async ({ page }) => {
    await serveBridge(page, platforms)
    await serveVersions(page, versions)
    await page.goto('/')
    await expect(page.getByRole('status')).toContainText('no compatible platforms')
    await expect(launchButtons(page)).toHaveCount(0)
  })

for (const { name, status, json } of [
  { name: 'missing', status: 404, json: {} },
  { name: 'duplicate version', status: 200, json: { google: [1, 1] } },
  { name: 'array', status: 200, json: [] },
])
  test(`${name} Distribution catalog disables launch`, async ({ page }) => {
    await serveBridge(page)
    await page.route(versionsUrl, (route) =>
      route.fulfill({ status, json, headers: { 'Access-Control-Allow-Origin': '*' } }),
    )
    await page.goto('/')
    await expect(page.getByRole('status')).toContainText('Could not load Bridge configuration')
    await expect(launchButtons(page)).toHaveCount(0)
  })

for (const credential of ['bridge-provided', undefined, null, ''])
  test(`validates the Bridge client credential: ${JSON.stringify(credential)}`, async ({
    page,
  }) => {
    await serveVersions(page, { github: [1] })
    await serveBridge(page, {
      github: { clientId: 'test-client', clientCredential: credential },
    })
    await page.goto('/')
    if (credential) await expect(launchButton(page, 'GitHub')).toBeEnabled()
    else await expect(page.getByRole('status')).toContainText('Could not load Bridge configuration')
  })

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

for (const [platform, name] of platforms)
  for (const blocked of [false, true])
    test(`${name} popup launch${blocked ? ' through the native anchor' : ''}, closure and retry`, async ({
      page,
      context,
    }) => {
      // Only transport setup is exercised here. No simulated proof delivery or OAuth consent.
      await servePrefetch(
        context,
        fixtureDocument(
          await servePopup(context),
          'Prefetch test boundary',
          `${blocked ? 'await new Promise(resolve => { window.authenticate = resolve });' : ''}
          const connection = accept();
          await connection.ready;
          window.connected = true;`,
        ),
      )
      await openApp(page, {
        versions: { google: [1], x: [1], github: [1] },
        blocked,
        platforms: {
          ...config.platforms,
          x: { clientId: 'test-client' },
        },
      })
      const key = platform === 'google' ? (blocked ? 'Space' : 'Enter') : undefined
      const popup = await launch(page, name, key)
      await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
      await expect(page.locator('#ccdp')).toHaveText(ccdp)
      const row = newestRun(page)
      if (blocked) {
        await expect(closeButton(row)).toBeDisabled()
        await waitForFixture(popup, 'authenticate')
        await popup.evaluate(() => window.authenticate!())
      }
      await waitForFixture(popup, 'connected')
      expect(new URLSearchParams(new URL(popup.url()).hash.slice(1)).get('platformId')).toBe(
        platform,
      )
      await expectLaunchesEnabled(page, 3)
      await expect(runs(page)).toHaveCount(1)
      await expectRun(row, name, 'Running')
      await expect(closeButton(row)).toBeEnabled()
      await closeButton(row).click()
      await expect(row.locator('.run-status')).toHaveText('Popup connection ended')
      await expectClosed(popup)
      await expectLaunchesEnabled(page, 3)
      expect(await results(page)).toEqual([{ status: 'closed' }])
      await expect(row.locator('.run-outcome')).toHaveText('Interrupted')
      await expect(row.getByRole('cell').nth(3)).toHaveText(/^\d+\.\d s$/)
      await expect(row.locator('.operation-timings li')).toContainText('Prefetch dispatch')
      await expect(row.locator('.operation-timings li')).toContainText('(interrupted)')
      if (platform !== 'google' || blocked) return
      const second = await launch(page, 'X')
      await waitForFixture(second, 'connected')
      await expect(runs(page)).toHaveCount(2)
      await expectRun(row, 'X', 'Running')
      await expectRun(runs(page).nth(1), 'Google', 'Interrupted')
      await closeRun(row, second, 'Interrupted')
      await page.reload()
      await expect(runs(page)).toHaveCount(0)
      await expect(page.locator('#history-empty')).toBeVisible()
    })

for (const blocked of [false, true])
  for (const transportFailure of [false, true])
    test(`${transportFailure ? 'transport' : 'ceremony'} failure keeps the popup open${blocked ? ' through the native anchor' : ''} until manually closed`, async ({
      page,
      context,
    }) => {
      await servePrefetch(context, '<!doctype html><title>Failure test boundary</title>')
      await openApp(page, { blocked })
      const google = launchButton(page, 'Google')
      await expect(google).toBeEnabled()
      const popup = await launch(page, 'Google')
      await expect(popup).toHaveURL(/\/ccdp\/v1\/prefetch#/)
      await expect(page.locator('#ccdp')).toHaveText(ccdp)
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
      const row = newestRun(page)
      await expect(page.locator('.run-status')).toContainText('Invalid GitHub id')
      await expect(closeButton(row)).toBeEnabled()
      await expect(page.locator('#history')).toContainText('Failed (identity-fetch)')
      expect(popup.isClosed()).toBe(false)
      await expect(row.locator('.run-status')).toHaveText(
        '<img src=x onerror=alert(1)> Invalid GitHub id',
      )
      await expect(page.locator('.run-status img')).toHaveCount(0)
      await expect(google).toBeEnabled()
      await closeRun(row, popup)
      await expect(page.locator('#history')).toContainText('Failed (identity-fetch)')
      await expect(google).toBeEnabled()
    })

// Runs that end before proof preparation: closed from the popup, or denied by the user.
const endings = {
  closed: { outcome: 'Interrupted', status: 'Popup connection ended', end: closeFromPopup },
  denied: {
    outcome: 'Denied',
    status: 'Authorization was denied.',
    end: async (popup: Page) => {
      await send(popup, { type: 'user-denied' })
      await expectClosed(popup)
    },
  },
}

for (const [platform, name, outcome = 'failed', fallback = false] of [
  ...platforms,
  ['google', 'Google', 'success'],
  ['google', 'Google', 'denied'],
  ['google', 'Google', 'closed'],
  ['google', 'Google', 'success', true],
  ['google', 'Google', 'failed', true],
] as const) {
  test(`${name} operation timings${fallback ? ' with fallback' : ''} preserve occurrences and freeze on ${outcome}`, async ({
    page,
    context,
  }) => {
    const notarized = platform !== 'google'
    // A fallback delays Prover readiness, and what follows it, by 700 ms.
    const shift = fallback ? 700 : 0
    await serveCeremony(context)
    await page.clock.install()
    await openApp(page, {
      versions: { [platform]: [1] },
      platforms: {
        [platform]: {
          clientId: 'client',
          ...(platform === 'github' ? { clientCredential: 'bridge-provided' } : {}),
        },
      },
    })
    const { popup } = await launchRun(page, name)
    const prefetch = timingDetails(page, /^Prefetch dispatch/)
    await expect(prefetch.locator('dl')).toBeHidden()
    await prefetch.locator('summary').click()
    await expect(prefetch.locator('dt')).toHaveText([
      'document startup',
      'connection',
      'worker ready',
      'dispatch',
    ])
    await expect(prefetch.locator('dd')).toHaveText(['25 ms', '2000 ms', '75 ms', '30 ms'])
    await prefetch.locator('summary').click()
    await expect(prefetch.locator('dl')).toBeHidden()
    await page.clock.runFor(5000)
    await returnToProver(popup)
    const returnedAt = await page.evaluate(() => performance.timeOrigin + performance.now())
    // Explicit occurrence times test transport delay independently of the app's delivery clock.
    const emit = (
      name: string,
      phase: 'started' | 'finished' | undefined,
      offset: number,
      attributes?: Record<string, number>,
    ) => send(popup, event(name, phase, returnedAt + offset, attributes))
    await emit('authorization', 'finished', 0)
    if (fallback) {
      await page.clock.runFor(1000)
      await emit('prover-fallback', undefined, 100)
      await expect(page.locator('.operation-timings')).toContainText('Prover fallback')
      await page.clock.runFor(1500)
      await expect(page.locator('.operation-timings')).toContainText(
        /Prover fallback · \d+\.\d s \(running\)/,
      )
    }
    await emit('prover', 'started', 10 + shift)
    const fallbackTiming = timing(page, 'Prover fallback')
    if (fallback) await expect(fallbackTiming).toHaveText('Prover fallback · 0.6 s')
    else await expect(fallbackTiming).toHaveCount(0)
    await waitForFixture(popup, 'requested')
    if (platform === 'github')
      expect(await popup.evaluate(() => window.proveIdentity!.clientCredential)).toBe(
        'bridge-provided',
      )
    if (outcome === 'closed' || outcome === 'denied') {
      const ending = endings[outcome]
      await ending.end(popup)
      await expect(page.locator('.run-outcome')).toHaveText(ending.outcome)
      await expect(page.locator('.run-status')).toHaveText(ending.status)
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
      await expect(page.locator('.operation-timings [data-status="running"]')).toHaveCount(0)
      await expect(timing(page, /^Proving ·/)).toHaveAttribute('data-status', 'interrupted')
      expect(await results(page)).toEqual([{ status: outcome }])
      await expectFrozen(page)
      return
    }
    await emit('zk-proof-preparation', 'started', 20 + shift)
    await expect(page.locator('.run-status')).toHaveText('Preparing your identity proof')
    const preparation = timing(page, 'ZK proof preparation')
    await expect(preparation).toHaveAttribute('data-status', 'running')
    await expect(preparation).toHaveCSS('font-weight', '600')
    const runningColor = await preparation.evaluate((element) => getComputedStyle(element).color)
    const attributes = {
      'openings-ms': 150,
      'finalization-ms': 30,
      'sent-bytes': 60,
      'received-bytes': 40,
      'committed-sent-bytes': 20,
      'committed-received-bytes': 30,
      'commitment-count': 2,
    }
    const attestations = timingDetails(page, /attestation/)
    if (notarized) {
      await emit('token-fetch', 'started', 20)
      await emit('token-fetch', 'finished', 1000)
      await emit('token-attestation', 'started', 1000)
      await emit('identity-fetch', 'started', 1000)
      await emit('identity-fetch', 'finished', 2000)
      await emit('identity-attestation', 'started', 2000)
      await emit('token-attestation', 'finished', 1180, {
        ...attributes,
        'response-header-bytes': 19,
        'response-body-bytes': 21,
        constructor: 1,
      })
      await expect(attestations).toHaveCount(1)
      await expect(attestations.locator('summary')).toHaveText('Token attestation · 0.2 s')
      // Token completion arrives after identity fetch, but occurred earlier.
      await expect
        .poll(() => page.locator('.operation-timings li span').allTextContents())
        .toEqual([
          expect.stringMatching(/^Prefetch dispatch ·/),
          expect.stringMatching(/^Authorization ·/),
          expect.stringMatching(/^Token fetch ·/),
          expect.stringMatching(/^Token attestation ·/),
          expect.stringMatching(/^Identity fetch ·/),
          expect.stringMatching(/^Proving ·.*\(running\)$/),
          expect.stringMatching(/^ZK proof preparation ·.*\(running\)$/),
          expect.stringMatching(/^Identity attestation ·.*\(running\)$/),
        ])
      await expect(attestations.locator('dl')).toBeHidden()
      await attestations.locator('summary').click()
      await expect(attestations.locator('dd')).toHaveText([
        '150 ms',
        '30 ms',
        '60 B',
        '40 B',
        '20 B',
        '30 B',
        '2',
        '19 B',
        '21 B',
        '1',
      ])
      await expect(attestations.locator('dt').filter({ hasText: /^constructor$/ })).toHaveAttribute(
        'title',
        '',
      )
      await expect(attestations.locator('dl')).toBeVisible()
      await page.clock.runFor(100)
      await expect(attestations.locator('dl')).toBeVisible()
      await attestations.locator('summary').press('Enter')
      await expect(attestations.locator('dl')).toBeHidden()
    }
    await emit('zk-proof-generation', 'started', 2500)
    await emit('zk-proof-preparation', 'finished', 2600)
    await expect(preparation).toHaveAttribute('data-status', 'completed')
    await expect(preparation).toHaveCSS('font-weight', '400')
    expect(await preparation.evaluate((element) => getComputedStyle(element).color)).not.toBe(
      runningColor,
    )
    expect(
      await preparation.evaluate((element) => getComputedStyle(element, '::marker').content),
    ).toContain('✓')
    await emit('zk-proof-generation', 'finished', 3500)
    await expect(page.locator('.run-status')).toHaveText('Creating your identity proof with ZK')
    await expect(page.locator('.operation-timings')).toContainText('ZK proof generation · 1.0 s')
    await expect(newestRun(page).locator('.run-outcome')).toHaveText('Running')
    // This synthetic delivery checks UI only; no browser proof generation is claimed.
    await page.clock.runFor(4500)
    if (notarized) {
      await emit('identity-attestation', 'finished', 4000, { ...attributes, 'openings-ms': 1970 })
      await expect(attestations).toHaveCount(2)
      await expect(attestations.locator('summary')).toHaveText([
        'Token attestation · 0.2 s',
        'Identity attestation · 2.0 s',
      ])
      for (const item of await attestations.all()) await expect(item.locator('dl')).toBeHidden()
      // Missing header/body observations do not turn into zero-valued measurements.
      await expect(attestations.last().locator('dt')).not.toContainText([
        'response header',
        'response body',
      ])
    }
    // pauseAt affects both documents; their clocks can differ after navigation.
    const times = await Promise.all([page, popup].map((p) => p.evaluate(() => Date.now())))
    await page.clock.pauseAt(Math.max(...times) + 1000)
    if (outcome === 'success') await sendProof(popup)
    else await send(popup, identityFetchFailure('Invalid GitHub id'))
    await expect(page.locator('#history')).toContainText(
      outcome === 'success' ? 'Proof received' : 'Failed (identity-fetch)',
    )
    // The app closes success without waiting for an application timer.
    if (outcome === 'success') await expectClosed(popup)
    else expect(popup.isClosed()).toBe(false)
    const timings = page.locator('.operation-timings li')
    const operations = [
      'Prefetch dispatch',
      'Authorization',
      ...(fallback ? ['Prover fallback'] : []),
      ...(notarized ? ['Token fetch', 'Token attestation', 'Identity fetch'] : []),
      'ZK proof preparation',
      'ZK proof generation',
      ...(notarized ? ['Identity attestation'] : []),
      'Proving',
    ]
    await expect(timings).toHaveCount(operations.length)
    await expect
      .poll(async () =>
        (await timings.locator('span').allTextContents()).map((text) => text.split(' · ')[0]),
      )
      .toEqual(operations)
    await expect(page.locator('.operation-timings [data-status="running"]')).toHaveCount(0)
    await expect(timing(page, /^Proving ·/)).toHaveAttribute(
      'data-status',
      outcome === 'success' ? 'completed' : 'interrupted',
    )
    await expect(preparation).toHaveAttribute('data-status', 'completed')
    if (fallback) await expect(fallbackTiming).toHaveText('Prover fallback · 0.6 s')
    const cells = newestRun(page).getByRole('cell')
    const total = Number.parseFloat((await cells.nth(3).textContent())!)
    await expect(cells).toHaveCount(6)
    expect(total).toBeGreaterThanOrEqual(9.4)
    await expectFrozen(page)
  })
}

for (const blocked of [false, true])
  test(`concurrent runs keep controls, stages and results separate${blocked ? ' with native anchors' : ''}`, async ({
    page,
    context,
  }) => {
    await serveCeremony(context)
    await openApp(page, {
      blocked,
      platforms: {
        google: { clientId: 'client' },
        x: { clientId: 'client' },
      },
    })
    const first = await launchRun(page, 'Google')
    const second = await launchRun(page, 'Google')
    const third = await launchRun(page, 'X')
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
    await expect(runs(page)).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(3)
    for (const run of [first, second, third]) {
      expect(run.popup.isClosed()).toBe(false)
      await returnToProver(run.popup)
      await send(run.popup, event('authorization', 'finished'), event('prover', 'started'))
      await waitForFixture(run.popup, 'requested')
    }
    await send(first.popup, event('zk-proof-generation', 'started'))
    await send(third.popup, event('token-fetch', 'started'))
    await expect(first.row.locator('.run-status')).toHaveText(
      'Creating your identity proof with ZK',
    )
    await expect(second.row.locator('.run-status')).toHaveText('Preparing your identity proof')
    await expect(third.row.locator('.run-status')).toHaveText('Notarizing your identity data')
    // Complete the later Google run first; this is synthetic UI delivery, not a generated proof.
    await sendProof(second.popup)
    await expectClosed(second.popup)
    await expect(second.row.locator('.run-outcome')).toHaveText('Proof received')
    await expect(first.row.locator('.run-outcome')).toHaveText('Running')
    await expect(third.row.locator('.run-outcome')).toHaveText('Running')
    expect(first.popup.isClosed()).toBe(false)
    expect(third.popup.isClosed()).toBe(false)

    await closeRun(first.row, first.popup, 'Interrupted')
    await expect(closeButton(third.row)).toBeEnabled()
    expect(third.popup.isClosed()).toBe(false)
    await send(third.popup, identityFetchFailure('Identity request failed'))
    await expect(third.row.locator('.run-outcome')).toHaveText('Failed (identity-fetch)')
    expect(third.popup.isClosed()).toBe(false)
    expect(
      await page.evaluate(() =>
        Object.fromEntries([...window.results].map(([id, result]) => [id, result.status])),
      ),
    ).toEqual({
      [first.id]: 'closed',
      [second.id]: 'accepted',
      [third.id]: 'failed',
    })

    const fourth = await launchRun(page, 'Google')
    await third.popup.close()
    await page.evaluate(() => {
      const encode = TextEncoder.prototype.encode
      // Fail only the next launch's startup input, not unrelated encodes such as error text.
      TextEncoder.prototype.encode = function (this: TextEncoder, input?: string) {
        if (input !== 'libid/ceremony/dev') return encode.call(this, input)
        TextEncoder.prototype.encode = encode
        throw new Error('Input preparation failed after opening the popup')
      }
    })
    const failedPopupOpened = blocked ? undefined : page.waitForEvent('popup')
    await launchButton(page, 'Google').click()
    const failedPopup = await failedPopupOpened
    await expect(newestRun(page).locator('.run-outcome')).toHaveText('Failed to start')
    if (failedPopup) {
      expect(failedPopup.isClosed()).toBe(false)
      await closeRun(newestRun(page), failedPopup)
      await expect(newestRun(page).locator('.run-outcome')).toHaveText('Failed to start')
    }
    await expect(fourth.row.locator('.run-outcome')).toHaveText('Running')
    expect(fourth.popup.isClosed()).toBe(false)
    await closeRun(fourth.row, fourth.popup, 'Interrupted')
    await expect(fourth.row.locator('.run-outcome')).toHaveText('Interrupted')
    expect(await page.evaluate((id) => window.results.get(id)?.status, fourth.id)).toBe('closed')
    await expect(second.row.locator('.run-outcome')).toHaveText('Proof received')
  })

for (const blocked of [false, true])
  test(`GitHub consent-page closure fails the run${blocked ? ' after native-anchor launch' : ''}`, async ({
    page,
    context,
  }) => {
    await serveCeremony(context)
    await openApp(page, {
      versions: { github: [1] },
      blocked,
      platforms: {
        github: {
          ...config.platforms.github,
          clientCredential: 'test-public-credential',
        },
      },
    })
    const { popup, row } = await launchRun(page, 'GitHub')
    await expect(popup).toHaveURL(/^https:\/\/github\.com\/login\/oauth\/authorize/)
    await popup.close()
    await expect(row.locator('.run-outcome')).toHaveText('Failed (authorization)')
    await expect(row.locator('.run-status')).toContainText('closed or isolated')
    await expect(row.locator('.run-actions')).toBeEmpty()
    await expect.poll(() => results(page)).toEqual([{ status: 'failed' }])
  })
