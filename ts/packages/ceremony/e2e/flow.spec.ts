import { readFileSync } from 'node:fs'
import fixture from '../src/barretenberg/circuits/oidc_google/google-v1.fixture.json' with {
  type: 'json',
}
import { buildGooglePublicInputs } from '../src/barretenberg/circuits/oidc_google/publicInputs.js'
import type { GoogleProofV1 } from '../src/platforms/google/1/types.js'
import { expect, test } from './fixtures.js'
import { verifyBrowserProof } from './verify.js'

for (const native of [false, true])
  test(`actual popup: private callback, isolation, denial, and application continuation${native ? ' with native anchor' : ''} [LIBID-BROWSER-001] [LIBID-BROWSER-005]`, async ({
    app,
    bridge,
    page,
    context,
  }) => {
    const errors: string[] = []
    const callbackScripts: string[] = []
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
    context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
    await context.route('https://accounts.google.com/**', async (route) => {
      const state = new URL(route.request().url()).searchParams.get('state')
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>location.replace(${JSON.stringify(`${bridge}/auth/callback#error=access_denied&state=${state}`)})</script>`,
      })
    })
    await page.goto(`${app}?ledger=${native ? 'test:mainnet' : 'test:testnet'}`)
    await page.waitForFunction(() => window.ready)
    if (native)
      await page.evaluate(() => {
        window.open = () => null
      })
    const popupPromise = context.waitForEvent('page')
    await page.locator('#launch').click()
    const popup = await popupPromise
    try {
      await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'denied' })
    } catch (error) {
      console.log({
        path: new URL(popup.url()).pathname,
        text: await popup.locator('body').innerText(),
        errors,
        events: await page.evaluate(() => window.events),
      })
      throw error
    }
    expect(await popup.evaluate(() => location.hash)).toBe('')
    expect(await popup.evaluate(() => crossOriginIsolated)).toBe(true)
    expect(await page.evaluate(() => window.ceremonyClosed)).toBeUndefined()
    await page.evaluate(() => window.after())
    await expect.poll(() => page.evaluate(() => window.afterReady)).toBe(true)
    expect(errors).toEqual([])
    expect(callbackScripts).toEqual([])
  })

test('emitted route policies and inert missing paths [CSP-001] [CSP-003]', async ({
  request,
  ccdp,
}) => {
  for (const path of [
    '/ccdp/v1/prefetch',
    '/ccdp/v1/prover',
    '/ccdp/v1/prover/fallback',
    '/ccdp/v1/worker.js',
    '/ccdp/callback.html',
  ]) {
    const a = await request.get(ccdp + path),
      b = await request.get(`${ccdp + path}?not-a-config=1`)
    expect(a.status()).toBe(200)
    expect(await a.body()).toEqual(await b.body())
    expect(a.headers()['x-content-type-options']).toBe('nosniff')
    expect(a.headers()['cache-control']).toBe('no-cache')
  }
  const fallback = await request.get(`${ccdp}/ccdp/v1/prover/fallback`)
  expect(fallback.headers()['cross-origin-embedder-policy']).toBe('require-corp')
  const worker = await request.get(`${ccdp}/ccdp/v1/worker.js`)
  expect(worker.headers()['service-worker-allowed']).toBe('/')
  expect((await request.get(`${ccdp}/ccdp/v99/prover`)).status()).toBe(404)
})

test('migrates the known nested worker and joins a pending prefetch [LIBID-ASSET-020]', async ({
  app,
  bridge,
  ccdp,
  page,
  context,
  request,
}) => {
  const graph = JSON.parse(
    readFileSync(
      new URL('../.cache/qualification-assets/distribution-graph.json', import.meta.url),
      'utf8',
    ),
  )
  const asset = graph.requestsByProfile['google/1'].find((r: { url: string }) =>
    r.url.endsWith('/oidc_google.json'),
  ).url
  const control = `${ccdp}/qualification-control?asset=${encodeURIComponent(asset)}`
  const before = (await (await request.get(`${control}&hold=1`)).json()).count
  const seed = await context.newPage()
  await seed.goto(`${ccdp}/ccdp/v1/seed`)
  await seed.evaluate(async () => {
    for (const scope of ['/', '/ccdp/v1/']) {
      const r = await navigator.serviceWorker.register('/ccdp/v1/worker.js', {
        scope,
        type: 'module',
      })
      await new Promise<void>((resolve) => {
        const poll = () => (r.active?.state === 'activated' ? resolve() : setTimeout(poll, 20))
        poll()
      })
    }
  })
  await seed.close()
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/auth/callback#error=access_denied&state=${state}`)})</script>`,
    })
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  const popupPromise = context.waitForEvent('page')
  await page.locator('#launch').click()
  const popup = await popupPromise
  await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'denied' })
  expect(
    await popup.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    ),
  ).toEqual(['/'])
  const fetched = popup.evaluate(
    async (asset) => (await fetch(asset)).arrayBuffer().then((b) => b.byteLength),
    asset,
  )
  await expect.poll(async () => (await (await request.get(control)).json()).count).toBe(before + 1)
  await request.get(`${control}&release=1`)
  expect(await fetched).toBeGreaterThan(0)
  expect((await (await request.get(control)).json()).count).toBe(before + 1)
  await page.evaluate(() => window.after())
  await expect.poll(() => page.evaluate(() => window.afterReady)).toBe(true)
})

test('immutable assets reuse the HTTP cache after Cache Storage eviction [LIBID-ASSET-017]', async ({
  ccdp,
  browser,
  request,
}, testInfo) => {
  const graph = JSON.parse(
    readFileSync(
      new URL('../.cache/qualification-assets/distribution-graph.json', import.meta.url),
      'utf8',
    ),
  )
  const asset = graph.requestsByProfile['google/1']
    .filter(
      (r: { url: string; range?: string }) =>
        r.url.startsWith('/') && !r.range && r.url.endsWith('.js'),
    )
    .sort((a: { bytes: number }, b: { bytes: number }) => a.bytes - b.bytes)[0]
  const control = `${ccdp}/qualification-control?asset=${encodeURIComponent(asset.url)}`
  const before = (await (await request.get(control)).json()).count
  const args = [...(testInfo.project.use.launchOptions?.args ?? [])]
  if (browser.browserType().name() === 'chromium' && ccdp.startsWith('https:'))
    args.push(
      `--ignore-certificate-errors-spki-list=${readFileSync(new URL('../.cache/e2e/cert-spki', import.meta.url), 'utf8')}`,
    )
  // WebKit's ephemeral test context does not retain this HTTP-cache entry.
  const context = await browser
    .browserType()
    .launchPersistentContext(testInfo.outputPath('http-cache-profile'), {
      ...testInfo.project.use.launchOptions,
      args,
      ignoreHTTPSErrors: true,
    })
  try {
    const page = await context.newPage()
    await page.goto(`${ccdp}/ccdp/v1/seed`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/ccdp/v1/worker.js', { scope: '/', type: 'module' })
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          }),
        )
    })
    // No Playwright routes: routing disables the browser HTTP cache being tested.
    expect(
      await page.evaluate(
        async (url) => (await (await fetch(url)).arrayBuffer()).byteLength,
        asset.url,
      ),
    ).toBe(asset.bytes)
    expect((await (await request.get(control)).json()).count).toBe(before + 1)
    await request.get(`${control}&fail=1`)
    for (let attempt = 0; attempt < 2; attempt++) {
      // Evict a durable entry so an unfinished write's flight cannot mask HTTP-cache reuse.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const cache = await caches.open('libid-ceremony-assets-v1')
            return (await cache.keys()).length
          }),
        )
        .toBe(1)
      expect(
        await page.evaluate(async (url) => {
          await caches.delete('libid-ceremony-assets-v1')
          const response = await fetch(url)
          if (!response.ok) throw new Error(`Asset response ${response.status}`)
          return (await response.arrayBuffer()).byteLength
        }, asset.url),
      ).toBe(asset.bytes)
    }
    expect((await (await request.get(control)).json()).count).toBe(before + 1)
  } finally {
    try {
      await request.get(`${control}&restore=1`)
    } finally {
      await context.close()
    }
  }
})

test('real Google fixture proof under emitted CSP, independently released-key verified [LIBID-PROVER-001] [CSP-020]', async ({
  app,
  bridge,
  page,
  context,
}) => {
  test.setTimeout(480000)
  // This controlled fixture is old and has its own digest. This proves runtime/key
  // compatibility, not real consent or authorization for the application transaction.
  // WebKit's controlled-page fetch bypasses Playwright routing. Substitute only
  // this public JWKS fixture at the page boundary; all proof assets use real loaders.
  // This does not qualify the live JWKS endpoint's CORS/CSP behavior.
  await context.addInitScript((key) => {
    Date.now = () => 1725001000000
    const fetch = window.fetch
    window.fetch = (...args) =>
      String(args[0]) === 'https://www.googleapis.com/oauth2/v3/certs'
        ? Promise.resolve(
            new Response(JSON.stringify({ keys: [key] }), {
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : fetch(...args)
  }, fixture.jwk)
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/auth/callback#id_token=${fixture.idToken}&state=${state}&version_info=synthetic&provider_meta=future&release.rev=1`)})</script>`,
    })
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  await page.locator('#launch').click()
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(() => window.result?.status)
        if (status === 'failed') {
          console.log('Fixture progress:', await page.evaluate(() => window.events))
          throw new Error('Fixture ceremony failed')
        }
        return status
      },
      { timeout: 420000 },
    )
    .toBe('accepted')
  const result = await page.evaluate(() => {
    const result = window.result
    if (result?.status !== 'accepted' || result.identity.platformId !== 'google')
      throw new Error('Missing Google proof')
    const proof = result.oauthProof.proof
    return {
      identity: result.identity,
      ...proof,
      identityProof: Array.from(proof.identityProof),
      signingKeyModulus: Array.from(proof.signingKeyModulus),
    }
  })
  const proof: GoogleProofV1 = {
    tokenExpiresAt: result.tokenExpiresAt,
    identityProof: Uint8Array.from(result.identityProof),
    signingKeyModulus: Uint8Array.from(result.signingKeyModulus),
  }
  const digest = Uint8Array.from(Buffer.from(fixture.authorizationDigest.replace(/^0x/, ''), 'hex'))
  await verifyBrowserProof('oidc_google', {
    proof: result.identityProof,
    publicInputs: buildGooglePublicInputs(digest, result.identity, proof),
  })
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

test('authenticated worker failure aborts before OAuth [LIBID-OAUTH-026]', async ({
  app,
  ccdp,
  page,
  context,
}) => {
  let oauth = 0
  await context.route('https://accounts.google.com/**', (route) => {
    oauth++
    return route.abort()
  })
  const control = `${ccdp}/qualification-control?asset=/ccdp/v1/worker.js`
  await context.request.get(`${control}&fail`)
  try {
    await page.goto(app)
    await page.waitForFunction(() => window.ready)
    await page.locator('#launch').click()
    await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'failed' })
    expect(oauth).toBe(0)
    expect(await page.evaluate(() => window.failureEvent)).toBe('prefetch-dispatch')
  } finally {
    await context.request.get(`${control}&restore`)
  }
})

test('two independently supplied connections cannot replace each other [LIBID-BROWSER-014]', async ({
  app,
  bridge,
  page,
  context,
}) => {
  const states = new Set<string>()
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')!
    states.add(state)
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/auth/callback#error=access_denied&state=${state}`)})</script>`,
    })
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  await page.locator('#launch').click()
  await page.locator('#launch').click()
  await expect.poll(() => page.evaluate(() => window.completed.length)).toBe(2)
  expect(states.size).toBe(2)
  expect(await page.evaluate(() => window.completed)).toEqual([
    { status: 'denied' },
    { status: 'denied' },
  ])
})

test('Callback clears unsupported versions and unconfigured direct visits locally [KIT-010] [CSP-007]', async ({
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
  // Native JSON error wording differs across engines; the bounded text remains local.
  await expect(page.getByRole('status')).toContainText('Return to your application.')
  await expect(page.getByRole('status')).toContainText(/JSON/i)
  expect(page.url()).toBe(`${ccdp}/ccdp/callback.html`)
  expect(outbound).toEqual([])
})

// Real RC WASM and its nested module workers; no simulated SDK initialization.
test('released TLSNotary initializes concurrently from mounted assets [LIBID-ASSET-017]', async ({
  ccdp,
  page,
  context,
}) => {
  test.setTimeout(90000)
  const graph = JSON.parse(
    readFileSync(
      new URL('../.cache/qualification-assets/distribution-graph.json', import.meta.url),
      'utf8',
    ),
  )
  const resources = graph.requestsByProfile['x/1'] as { url: string }[]
  const moduleUrl = ccdp + resources.find((r) => r.url.endsWith('/tlsn_wasm.js'))!.url
  const wasmUrl = ccdp + resources.find((r) => r.url.endsWith('/tlsn_wasm_bg.wasm'))!.url
  const snippet = resources.find((r) =>
    /\/snippets\/web-spawn-[^/]+\/js\/spawn\.js$/.test(r.url),
  )!.url
  const count = async () =>
    (
      await (
        await context.request.get(
          `${ccdp}/qualification-control?asset=${encodeURIComponent(snippet)}`,
        )
      ).json()
    ).count
  const before = await count()
  await page.goto(`${ccdp}/ccdp/v1/prover/fallback`)
  const result = await page.evaluate(
    async ({ moduleUrl, wasmUrl }) => {
      const code = `try{const {default:init,initialize}=await import(${JSON.stringify(moduleUrl)});await init({module_or_path:${JSON.stringify(wasmUrl)}});await initialize(null,2);postMessage('ready')}catch(e){postMessage(String(e))}`
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      try {
        return await Promise.all(
          [0, 1].map(
            () =>
              new Promise<string>((resolve, reject) => {
                const worker = new Worker(url, { type: 'module' })
                const timeout = setTimeout(() => {
                  worker.terminate()
                  reject(new Error('TLSN initialization timed out'))
                }, 60000)
                worker.onmessage = (event) => {
                  clearTimeout(timeout)
                  worker.terminate()
                  resolve(event.data)
                }
                worker.onerror = (event) => {
                  clearTimeout(timeout)
                  worker.terminate()
                  reject(new Error(`TLSN worker failed: ${event.message}`))
                }
              }),
          ),
        )
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { moduleUrl, wasmUrl },
  )
  expect(result).toEqual(['ready', 'ready'])
  expect(await count()).toBeGreaterThan(before)
})

test('Prover rejects a changed Application origin in the same opener window [TEST-CCDP-04]', async ({
  app,
  bridge,
  ccdp,
  page,
  context,
}) => {
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/auth/callback#error=access_denied&state=${state}`)})</script>`,
    })
  })
  // A second origin admitted by Callback's deployment. The retained WindowProxy
  // is unchanged, but this new document is not the Application Callback bound.
  await context.route(`${ccdp}/changed-application`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>
      window.addEventListener('message', event => {
        if (event.data?.type !== 'message-port') return
        const channel = new MessageChannel()
        event.source.postMessage(event.data, event.origin, [channel.port2])
      })
    </script>`,
    }),
  )
  await context.route(`${ccdp}/ccdp/v1/prover`, async (route) => {
    // Callback already authenticated and constructed the private fragment.
    await page.goto(`${ccdp}/changed-application`)
    await route.continue()
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  const popupPromise = context.waitForEvent('page')
  await page.locator('#launch').click()
  const popup = await popupPromise
  await expect(popup.locator('body')).toContainText('connection failed authentication')
  expect(await popup.evaluate(() => location.hash)).toBe('')
  expect(new URL(page.url()).origin).toBe(ccdp)
})

test('provider isolation ends Application and returning Callback reports its own connection failure [TEST-CCDP-08] [LIBID-BROWSER-005]', async ({
  app,
  bridge,
  page,
  context,
}) => {
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')
    // Serve COOP over HTTP: WebKit does not apply it to the intercepted response.
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/isolating-provider?state=${encodeURIComponent(state!)}`)})</script>`,
    })
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  const opened = context.waitForEvent('page')
  await page.locator('#launch').click()
  const popup = await opened
  await expect(popup.locator('#return')).toBeVisible()
  expect(await popup.evaluate(() => window.opener === null)).toBe(true)
  // Background polling may be suspended; observe from the active application.
  await page.bringToFront()
  await expect
    .poll(() => page.evaluate(() => window.ceremonyClosed))
    .toEqual({
      outcome: 'failed',
      code: 'popup-unavailable',
    })
  // Consent can continue even though Application has lost the window handle.
  expect(popup.isClosed()).toBe(false)
  await popup.locator('#return').click()
  await expect(popup.locator('[role="status"]')).toContainText(
    'Unable to reconnect to the application',
  )
  await expect(popup.locator('[role="status"]')).toContainText(
    'The sign-in provider may have isolated this window',
  )
  await expect(popup.locator('progress')).toHaveCount(0)
  await expect(popup).toHaveURL(`${bridge}/auth/callback`)
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  expect(await page.evaluate(() => window.completed)).toEqual([])
})
