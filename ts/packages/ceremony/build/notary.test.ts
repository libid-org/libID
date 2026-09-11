import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executionWorker } from '../src/ccdp/headers.ts'
import { responseHeaders } from './profiles.ts'

test('fixed response policies admit runtime notaries without remote code permission [LIBID-ASSET-003] [CSP-003/011]', () => {
  for (const profile of ['prover', 'proverFallback', 'executionWorker'] as const) {
    const policy = responseHeaders(profile, {})['Content-Security-Policy']
    const directives = new Map(
      policy.split(';').map((d) => {
        const [name, ...sources] = d.trim().split(/\s+/)
        return [name, sources]
      }),
    )
    assert.ok(directives.get('connect-src')!.includes('wss:'))
    assert.ok(directives.get('connect-src')!.includes('https:'))
    assert.ok(!policy.includes('notary.lib.id'))
    for (const name of ['script-src', 'worker-src']) {
      assert.ok(!directives.get(name)!.includes('https:'))
      assert.ok(!directives.get(name)!.includes('*'))
    }
  }
  for (const profile of ['prefetch', 'worker', 'proofWorker', 'leafWorker'] as const)
    assert.ok(!responseHeaders(profile, {})['Content-Security-Policy'].includes('wss:'))
})

test('all asset-fetching contexts explicitly admit their own origin [CSP-003] [CSP-018]', () => {
  const policies = [
    ...(
      [
        'prefetch',
        'prover',
        'proverFallback',
        'worker',
        'executionWorker',
        'proofWorker',
        'leafWorker',
      ] as const
    ).map((profile) => responseHeaders(profile, {})),
    executionWorker,
  ]
  for (const headers of policies) {
    const sources = headers['Content-Security-Policy']
      .split('connect-src ')[1]
      .split(';')[0]
      .trim()
      .split(/\s+/)
    assert.ok(sources.includes("'self'"))
    assert.ok(!sources.includes('http:') && !sources.includes('ws:'))
    assert.ok(!headers['Content-Security-Policy'].includes('upgrade-insecure-requests'))
  }
})
