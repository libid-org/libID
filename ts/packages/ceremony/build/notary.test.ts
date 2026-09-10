import assert from 'node:assert/strict'
import { test } from 'node:test'
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
