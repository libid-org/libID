// Actual popup and Callback flows, and the Prover UI they drive.
import { prepareCallback } from './callback.js'
import {
  describePopup,
  expect,
  expectApplicationContinues,
  expectIsolatedProver,
  test,
} from './fixtures.js'

for (const wildcard of [false, true])
  for (const native of [false, true])
    test(`actual popup: private callback, isolation, denial, and application continuation${native ? ' with native anchor' : ''}${wildcard ? ' with wildcard Callback admission' : ''} [LIBID-BROWSER-001] [LIBID-BROWSER-005]`, async ({
      bridge,
      ccdp,
      page,
      context,
      request,
      provider,
      launch,
    }) => {
      if (wildcard) {
        const artifact = await request.get(`${ccdp}/ccdp/callback.html`)
        const callback = prepareCallback(await artifact.text(), artifact.headers(), {
          allowedApplicationOrigins: ['*', ccdp],
          ccdpOrigin: ccdp,
        })
        await context.route(`${bridge}/auth/callback`, (route) => route.fulfill(callback))
      }
      const errors: string[] = []
      const callbackScripts: string[] = []
      const navigations: string[] = []
      const failedRequests: string[] = []
      await context.route('**/*', async (route) => {
        const request = route.request()
        if (
          request.resourceType() === 'script' &&
          !request.serviceWorker() &&
          new URL(request.frame().url()).origin === bridge
        ) {
          callbackScripts.push(new URL(request.url()).pathname)
          await route.abort()
        } else await route.fallback()
      })
      context.on('page', (p) => {
        p.on('pageerror', (e) => errors.push(e.message))
        p.on('framenavigated', (frame) => {
          const url = new URL(frame.url())
          navigations.push(url.origin + url.pathname)
        })
      })
      context.on('requestfailed', (request) => {
        const url = new URL(request.url())
        failedRequests.push(
          `${request.resourceType()} ${url.origin}${url.pathname}: ${request.failure()?.errorText}`,
        )
      })
      await provider()
      const popup = await launch(
        `?ledger=${native ? 'test:mainnet' : 'test:testnet'}`,
        native
          ? () =>
              page.evaluate(() => {
                window.open = () => null
              })
          : undefined,
      )
      try {
        await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'denied' })
      } catch (error) {
        console.log(
          'Popup flow failure:',
          JSON.stringify({
            path: new URL(popup.url()).pathname,
            popup: await describePopup(popup),
            errors,
            callbackScripts,
            navigations,
            failedRequests,
            runs: await page.evaluate(() => window.runs).catch(() => 'application unavailable'),
          }),
        )
        throw error
      }
      await expectIsolatedProver(popup)
      expect(await page.evaluate(() => window.ceremonyClosed)).toBeUndefined()
      await expectApplicationContinues(page)
      expect(errors).toEqual([])
      expect(callbackScripts).toEqual([])
    })

test('popup progress follows operation events independently of stage labels [LIBID-PROVER-011] [LIBID-BROWSER-024] [LIBID-BROWSER-025]', async ({
  app,
  page,
}) => {
  await page.clock.install()
  await page.goto(`${app}/ui`)
  const bar = page.getByRole('progressbar')
  await expect(bar).toHaveAttribute('value', '0')
  await expect(page.locator('.libid-activity')).toHaveCount(0)
  await expect(page.getByText('Preparing your identity proof')).toBeVisible()
  await page.evaluate(() => {
    for (const event of ['proof-worker-bootstrap', 'proof-wasm-load'])
      window.testEvents.emit({ event, phase: 'finished', timestamp: 1, status: 'active' })
  })
  const value = await bar.evaluate((node: HTMLProgressElement) => node.value)
  expect(value).toBeGreaterThan(0)
  await expect(page.getByText('Preparing your identity proof')).toBeVisible()
  await page.evaluate(() => {
    for (const event of ['proof-wasm-load', 'zk-proof-preparation', 'unrelated-observation'])
      window.testEvents.emit({ event, phase: 'finished', timestamp: 1, status: 'active' })
  })
  expect(await bar.evaluate((node: HTMLProgressElement) => node.value)).toBe(value)
  await page.clock.runFor(15000)
  await expect(page.getByText(/Still proving/)).toBeVisible()
  await page.evaluate(() => {
    window.testEvents.emit({
      event: 'zk-proof-generation',
      phase: 'started',
      timestamp: 2,
      status: 'active',
    })
    for (const event of [
      'proof-circuit-load',
      'proof-backend-initialization',
      'circuit-inputs',
      'signing-key-fetch',
      'witness',
      'proof',
    ])
      window.testEvents.emit({ event, phase: 'finished', timestamp: 3, status: 'active' })
  })
  // Proof work fills the bar before backend teardown and delivery.
  await expect(bar).toHaveAttribute('value', '1')
  await expect(page.getByText('Creating your identity proof with ZK')).toBeVisible()
  const frames = await page.evaluate(async () => {
    let frames = 0
    const requestFrame = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) =>
      requestFrame((time) => {
        frames++
        callback(time)
      })
    await window.testView.finishProof()
    window.requestAnimationFrame = requestFrame
    return frames
  })
  expect(frames).toBe(2)
  await page.evaluate(() => {
    window.testView.stop()
    window.testView.delivered()
  })
  await expect(bar).toHaveAttribute('value', '1')
  await expect(page.getByText('Proof delivered. Return to your application.')).toBeVisible()
  await expect(page.getByText(/Still proving/)).toHaveCount(0)
  await expect(page.locator('.libid-activity')).toHaveCount(0)
})

test('popup paint wait skips hidden documents and tolerates stopped animation frames [LIBID-BROWSER-024]', async ({
  app,
  page,
}) => {
  await page.goto(`${app}/ui`)
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    window.requestAnimationFrame = () => {
      throw new Error('Hidden documents should not wait')
    }
    await window.testView.finishProof()
  })
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    // Simulate frames stopping while the document is waiting to paint.
    window.requestAnimationFrame = () => 0
    await window.testView.finishProof()
  })
})

test('Callback clears unsupported versions and unconfigured direct visits locally [KIT-010] [CSP-007] [TEST-CCDP-02]', async ({
  bridge,
  ccdp,
  page,
}) => {
  const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  const outbound: string[] = []
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).pathname === '//auth/callback')
      await route.fulfill({ response: await page.request.get(`${bridge}/auth/callback`) })
    else if (route.request().isNavigationRequest()) await route.continue()
    else {
      outbound.push(route.request().resourceType())
      await route.abort()
    }
  })
  for (const path of [
    `/auth/callback?state=v99.${id}`,
    `/auth/callback#state=v99.${id}`,
    `//auth/callback?state=v99.${id}`,
  ]) {
    // A hash-only navigation in the previous Callback document does not rerun its entry.
    await page.goto('about:blank')
    await page.goto(bridge + path)
    await expect(page.getByRole('status')).toHaveText(
      'This ceremony version is no longer supported. Update the application and try again.',
    )
    await expect(page).toHaveURL(bridge + path.split(/[?#]/)[0])
  }
  await page.goto(`${ccdp}/ccdp/callback.html#state=v1.${id}`)
  // An unconfigured deployment slot fails with package-owned text, locally.
  await expect(page.getByRole('status')).toHaveText(
    'Invalid Callback inputs Return to your application.',
  )
  expect(page.url()).toBe(`${ccdp}/ccdp/callback.html`)
  expect(outbound).toEqual([])
})
