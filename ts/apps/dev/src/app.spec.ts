import { expect, test } from '@playwright/test'
import {
  ccdp,
  closeButton,
  closeRun,
  config,
  configUrl,
  event,
  expectClosed,
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

test('no compatible platforms disables launch [KIT-023]', async ({ page }) => {
  await serveBridge(page)
  await serveVersions(page, {})
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('no compatible platforms')
  await expect(launchButtons(page)).toHaveCount(0)
})

for (const [platform, name, blocked = false] of [...platforms, ['google', 'Google', true]] as const)
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
    expect(new URLSearchParams(new URL(popup.url()).hash.slice(1)).get('platformId')).toBe(platform)
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

for (const transportFailure of [false, true])
  test(`${transportFailure ? 'transport' : 'ceremony'} failure keeps the popup open until manually closed`, async ({
    page,
    context,
  }) => {
    await servePrefetch(context, '<!doctype html><title>Failure test boundary</title>')
    await openApp(page)
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

test('history shows running and completed timings [LIBID-BROWSER-006] [LIBID-BROWSER-007] [LIBID-BROWSER-030]', async ({
  page,
  context,
}) => {
  await serveCeremony(context)
  await openApp(page, { platforms: { google: { clientId: 'client' } } })
  const { popup, row } = await launchRun(page, 'Google')
  await expect(timing(page, /^Prefetch dispatch/)).toContainText('2000 ms')
  await returnToProver(popup)
  await send(popup, event('prover-fallback'), event('prover', 'started'))
  await waitForFixture(popup, 'requested')
  await expect(timing(page, /^Prover fallback/)).toHaveText(/Prover fallback · \d+\.\d s/)
  await send(popup, event('zk-proof-preparation', 'started'))
  const preparation = timing(page, /^ZK proof preparation/)
  await expect(preparation).toHaveAttribute('data-status', 'running')
  await expect(preparation).toContainText('(running)')
  await send(
    popup,
    event('zk-proof-preparation', 'finished'),
    event('zk-proof-generation', 'started'),
  )
  await expect(preparation).toHaveAttribute('data-status', 'completed')
  await expect(preparation).toHaveText(/ZK proof preparation · \d+\.\d s/)
  await expect(row.locator('.run-status')).toHaveText('Creating your identity proof with ZK')
  await send(popup, event('zk-proof-generation', 'finished'))
  await expectRun(row, 'Google', 'Running')
  // Synthetic delivery exercises the app's result handling, not proof generation.
  await sendProof(popup)
  await expectClosed(popup)
  await expectRun(row, 'Google', 'Proof received')
  await expect(timing(page, /^Proving ·/)).toHaveAttribute('data-status', 'completed')
  await expect(row.locator('[data-status="running"]')).toHaveCount(0)
})

test('denial closes the popup and updates its history row', async ({ page, context }) => {
  await serveCeremony(context)
  await openApp(page)
  const { popup, row } = await launchRun(page, 'Google')
  await returnToProver(popup)
  await send(popup, event('prover', 'started'))
  await waitForFixture(popup, 'requested')
  await send(popup, { type: 'user-denied' })
  await expectClosed(popup)
  await expectRun(row, 'Google', 'Denied')
  await expect(row.locator('.run-status')).toHaveText('Authorization was denied.')
  expect(await results(page)).toEqual([{ status: 'denied' }])
})

test('concurrent runs keep controls, stages and results separate', async ({ page, context }) => {
  await serveCeremony(context)
  await openApp(page, {
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
    await send(run.popup, event('prover', 'started'))
    await waitForFixture(run.popup, 'requested')
  }
  await send(first.popup, event('zk-proof-generation', 'started'))
  await send(third.popup, event('token-fetch', 'started'))
  await expect(first.row.locator('.run-status')).toHaveText('Creating your identity proof with ZK')
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

  await closeRun(third.row, third.popup)
  await expect(second.row.locator('.run-outcome')).toHaveText('Proof received')
})

test('GitHub consent-page closure fails the run', async ({ page, context }) => {
  await serveCeremony(context)
  await openApp(page, {
    versions: { github: [1] },
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
