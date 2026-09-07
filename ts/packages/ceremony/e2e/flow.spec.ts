import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildGooglePublicInputs } from '../src/platforms/google/1/publicInputs.js'
import fixture from '../test-fixtures/google-v1.json' with { type: 'json' }
import type { GoogleProofV1 } from '../src/platforms/google/1/types.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
const app = 'https://localhost:4681',
  bridge = 'https://localhost:4682',
  ccdp = 'https://localhost:4683'
for (const native of [false, true])
  test(`actual popup: private callback, isolation, denial, and application continuation${native ? ' with native anchor' : ''} [LIBID-BROWSER-001] [LIBID-BROWSER-005]`, async ({
    page,
    context,
  }) => {
    const errors: string[] = []
    context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
    await context.route('https://accounts.google.com/**', async (route) => {
      const state = new URL(route.request().url()).searchParams.get('state')
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>location.replace(${JSON.stringify(`${bridge}/callback#error=access_denied&state=${state}`)})</script>`,
      })
    })
    await page.goto(app)
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
  })
test('emitted route policies and inert missing paths [CSP-001] [CSP-003]', async ({ request }) => {
  for (const path of [
    '/ccdp/v1/prefetch',
    '/ccdp/v1/prover',
    '/ccdp/v1/prover/fallback',
    '/ccdp/v1/worker.js',
    '/ccdp/v1/callback.js',
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
  page,
  context,
  request,
}) => {
  const graph = JSON.parse(
    readFileSync(new URL('../.cache/distribution-graph.json', import.meta.url), 'utf8'),
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
      body: `<script>location.replace(${JSON.stringify(`${bridge}/callback#error=access_denied&state=${state}`)})</script>`,
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

test('real Google fixture proof under emitted CSP, independently released-key verified [LIBID-PROVER-001] [CSP-020]', async ({
  page,
  context,
}, testInfo) => {
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
      body: `<script>location.replace(${JSON.stringify(`${bridge}/callback#id_token=${fixture.idToken}&state=${state}`)})</script>`,
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
    if (result?.status !== 'accepted' || result.oauthProof.platformId !== 'google')
      throw new Error('Missing Google proof')
    const proof = result.oauthProof.proof
    return {
      ...proof,
      identityProof: Array.from(proof.identityProof),
      signingKeyModulus: Array.from(proof.signingKeyModulus),
    }
  })
  const proof: GoogleProofV1 = {
    ...result,
    identityProof: Uint8Array.from(result.identityProof),
    signingKeyModulus: Uint8Array.from(result.signingKeyModulus),
  }
  const digest = Uint8Array.from(Buffer.from(fixture.authorizationDigest.replace(/^0x/, ''), 'hex'))
  const output = new URL(
    `../.cache/${testInfo.project.name}-distribution-proof.json`,
    import.meta.url,
  )
  writeFileSync(
    output,
    JSON.stringify({
      proof: result.identityProof,
      publicInputs: buildGooglePublicInputs(digest, proof),
    }),
  )
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../qualification/ceremony/verify.mjs', import.meta.url)),
      'oidc_google',
      fileURLToPath(output),
    ],
    { stdio: 'pipe', timeout: 120000 },
  )
})

test('package UI has bounded progress and a nonblocking 15-second hint [LIBID-BROWSER-024] [LIBID-BROWSER-025]', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto(`${app}/ui`)
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0')
  await expect(page.getByText('Preparing proof')).toBeVisible()
  await page.clock.runFor(15000)
  await expect(page.getByText(/Still proving/)).toBeVisible()
  await page.evaluate(() => {
    window.testProgress.update(0.5, 'Generating proof')
    window.testProgress.stop()
  })
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '0.5')
  await expect(page.getByText(/Still proving/)).toHaveCount(0)
})
test('authenticated worker failure aborts before OAuth [LIBID-OAUTH-026]', async ({
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
  } finally {
    await context.request.get(`${control}&restore`)
  }
})
test('two independently supplied connections cannot replace each other [LIBID-BROWSER-014]', async ({
  page,
  context,
}) => {
  const states = new Set<string>()
  await context.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state')!
    states.add(state)
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(`${bridge}/callback#error=access_denied&state=${state}`)})</script>`,
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
