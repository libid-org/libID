import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executionWorker } from '../src/assets/headers.ts'
import { parseCsp, responseHeaders } from './profiles.ts'

test('fixed response policies admit runtime notaries without remote code permission [LIBID-ASSET-003] [CSP-003/011]', () => {
  for (const profile of ['prover', 'proverFallback', 'notaryWorker'] as const) {
    const policy = responseHeaders(profile)['Content-Security-Policy']
    const directives = parseCsp(policy)
    assert.ok(directives.get('connect-src')!.includes('wss:'))
    assert.ok(directives.get('connect-src')!.includes('https:'))
    assert.ok(!policy.includes('notary.lib.id'))
    for (const name of ['script-src', 'worker-src']) {
      assert.ok(!directives.get(name)!.includes('https:'))
      assert.ok(!directives.get(name)!.includes('*'))
    }
  }
  for (const profile of ['prefetch', 'worker', 'proofWorker', 'leafWorker'] as const)
    assert.ok(!responseHeaders(profile)['Content-Security-Policy'].includes('wss:'))
})

test('all asset-fetching contexts explicitly admit their own origin [CSP-003]', () => {
  const policies = [
    ...(
      [
        'prefetch',
        'prover',
        'proverFallback',
        'worker',
        'notaryWorker',
        'proofWorker',
        'leafWorker',
      ] as const
    ).map((profile) => responseHeaders(profile)),
    executionWorker,
  ]
  for (const headers of policies) {
    const sources = parseCsp(headers['Content-Security-Policy']).get('connect-src')!
    assert.ok(sources.includes("'self'"))
    assert.ok(!sources.some((source) => source.startsWith('http:')) && !sources.includes('ws:'))
    assert.ok(!headers['Content-Security-Policy'].includes('upgrade-insecure-requests'))
  }
})

test('pins every response profile security policy [CSP-001/002/003/009/015]', () => {
  const headers = (profile: Parameters<typeof responseHeaders>[0]) =>
    new Headers(responseHeaders(profile, { inline: ['void 0'] }))
  const csp = (profile: Parameters<typeof responseHeaders>[0]) =>
    parseCsp(headers(profile).get('content-security-policy') ?? '')
  const scripted = [
    'prover',
    'proverFallback',
    'prefetch',
    'callback',
    'worker',
    'notaryWorker',
    'proofWorker',
    'leafWorker',
  ] as const
  for (const profile of scripted) {
    const directives = csp(profile)
    for (const name of ['default-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors'])
      assert.deepEqual(directives.get(name), ["'none'"], `${profile} ${name}`)
    const scripts = directives.get('script-src') ?? []
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", 'https:', '*'])
      assert.ok(!scripts.includes(loose), `${profile} script-src ${loose}`)
    assert.equal(headers(profile).get('x-content-type-options'), 'nosniff', profile)
  }
  // Documents: never framed or referred; the Prover isolates by DIP, its fallback by COOP/COEP.
  for (const profile of ['prover', 'proverFallback', 'prefetch', 'callback'] as const) {
    assert.equal(headers(profile).get('referrer-policy'), 'no-referrer', profile)
    assert.equal(headers(profile).get('cache-control'), 'no-cache', profile)
  }
  const isolation = (profile: Parameters<typeof responseHeaders>[0]) => {
    const h = headers(profile)
    return [
      h.get('document-isolation-policy'),
      h.get('cross-origin-opener-policy'),
      h.get('cross-origin-embedder-policy'),
    ]
  }
  assert.deepEqual(isolation('prover'), ['isolate-and-require-corp', 'unsafe-none', null])
  assert.deepEqual(isolation('proverFallback'), [null, 'same-origin', 'require-corp'])
  // Prefetch and Callback keep the opener: they must not sever the application's handle.
  assert.deepEqual(isolation('prefetch'), [null, 'unsafe-none', null])
  assert.deepEqual(isolation('callback'), [null, 'unsafe-none', null])
  // WASM only where it compiles; no spawning from leaves.
  for (const profile of [
    'prover',
    'proverFallback',
    'notaryWorker',
    'proofWorker',
    'leafWorker',
  ] as const)
    assert.ok(csp(profile).get('script-src')!.includes("'wasm-unsafe-eval'"), profile)
  for (const profile of ['prefetch', 'callback', 'worker'] as const)
    assert.ok(!csp(profile).get('script-src')!.includes("'wasm-unsafe-eval'"), profile)
  assert.deepEqual(csp('leafWorker').get('worker-src'), ["'none'"])
  for (const profile of ['notaryWorker', 'proofWorker'] as const) {
    assert.deepEqual(csp(profile).get('worker-src'), ["'self'", 'blob:'], profile)
    assert.equal(headers(profile).get('cross-origin-embedder-policy'), 'require-corp', profile)
  }
  assert.equal(headers('leafWorker').get('cross-origin-embedder-policy'), 'require-corp')
  assert.equal(headers('worker').get('service-worker-allowed'), '/')
})
