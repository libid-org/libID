// Served CCDP routes, the asset Service Worker and its caches, and mounted TLSN assets.
import { readFileSync } from 'node:fs'
import { artifactRequests, expect, expectApplicationContinues, test } from './fixtures.js'

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

test('migrates the known nested worker and joins a pending prefetch [LIBID-ASSET-020] [TEST-DIST-03]', async ({
  ccdp,
  page,
  context,
  request,
  assetControl,
  assetCount,
  provider,
  launch,
}) => {
  const asset = artifactRequests('google/1').find((r) => r.url.endsWith('/oidc_google.json'))!.url
  const control = assetControl(asset)
  const before = await assetCount(asset)
  await request.get(`${control}&hold=1`)
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
  await provider()
  const popup = await launch()
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
  // Observe rejection if an assertion fails and teardown closes the popup.
  void fetched.catch(() => {})
  await expect.poll(() => assetCount(asset)).toBe(before + 1)
  await request.get(`${control}&release=1`)
  expect(await fetched).toBeGreaterThan(0)
  expect(await assetCount(asset)).toBe(before + 1)
  await expectApplicationContinues(page)
})

test('immutable assets reuse the HTTP cache after Cache Storage eviction [LIBID-ASSET-017]', async ({
  ccdp,
  browser,
  request,
  assetControl,
  assetCount,
}, testInfo) => {
  const asset = artifactRequests('google/1')
    .filter((r) => r.url.startsWith('/') && !r.range && r.url.endsWith('.js'))
    .sort((a, b) => a.bytes! - b.bytes!)[0]
  const control = assetControl(asset.url)
  const before = await assetCount(asset.url)
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
    expect(await assetCount(asset.url)).toBe(before + 1)
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
    expect(await assetCount(asset.url)).toBe(before + 1)
  } finally {
    await context.close()
  }
})

test('authenticated worker failure aborts before OAuth [LIBID-OAUTH-026]', async ({
  page,
  context,
  assetControl,
  launch,
}) => {
  let oauth = 0
  await context.route('https://accounts.google.com/**', (route) => {
    oauth++
    return route.abort()
  })
  const control = assetControl('/ccdp/v1/worker.js')
  await context.request.get(`${control}&fail`)
  await launch()
  await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'failed' })
  expect(oauth).toBe(0)
  expect(await page.evaluate(() => window.failureEvent)).toBe('prefetch-dispatch')
})

// Real RC WASM and its nested module workers; no simulated SDK initialization.
test('released TLSNotary initializes concurrently from mounted assets [LIBID-ASSET-017]', async ({
  ccdp,
  page,
  assetCount,
}) => {
  test.setTimeout(90000)
  const resources = artifactRequests('x/1')
  const moduleUrl = ccdp + resources.find((r) => r.url.endsWith('/tlsn_wasm.js'))!.url
  const wasmUrl = ccdp + resources.find((r) => r.url.endsWith('/tlsn_wasm_bg.wasm'))!.url
  const snippet = resources.find((r) =>
    /\/snippets\/web-spawn-[^/]+\/js\/spawn\.js$/.test(r.url),
  )!.url
  const before = await assetCount(snippet)
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
  expect(await assetCount(snippet)).toBeGreaterThan(before)
})
