// Read-only pre-consent checks. No OAuth credentials or provider calls.
import assert from 'node:assert/strict'
const bridge = 'https://localhost:4682'
const ccdp = 'https://localhost:4683'
const origin = 'https://localhost:4691'
const config = await fetch(`${bridge}/api/v1/ceremony/config`, { headers: { Origin: origin } })
assert.equal(config.status, 200)
assert.equal(config.headers.get('access-control-allow-origin'), origin)
assert.equal(config.headers.get('cache-control'), 'no-store')
const settings = await config.json()
assert.equal(settings.ccdpOrigin, ccdp)
assert.equal(settings.redirectUri, `${bridge}/auth/callback`)
assert.ok(Object.keys(settings.platforms).length > 0)
const refused = await fetch(`${bridge}/api/v1/ceremony/config`, {
  headers: { Origin: 'https://unlisted.example' },
})
assert.equal(refused.status, 403)
const callback = await fetch(`${bridge}/auth/callback?code=local-readiness-probe`)
assert.equal(callback.status, 200)
assert.equal(callback.headers.get('cache-control'), 'no-store')
assert.equal(callback.headers.get('cross-origin-opener-policy'), 'unsafe-none')
assert.match(callback.headers.get('content-security-policy') ?? '', /'sha256-/)
const html = await callback.text()
assert.ok(!html.includes('__LIBID_CALLBACK_CONFIG__'))
assert.ok(!html.includes('local-readiness-probe'))
const artifact = await fetch(`${ccdp}/ccdp/callback.html`)
assert.equal(artifact.status, 200)
assert.ok((await artifact.text()).includes('__LIBID_CALLBACK_CONFIG__'))
const isolated = await fetch(`${ccdp}/ccdp/v1/prover/fallback`)
assert.equal(isolated.status, 200)
assert.equal(isolated.headers.get('cross-origin-opener-policy'), 'same-origin')
assert.equal(isolated.headers.get('cross-origin-embedder-policy'), 'require-corp')
console.info(
  'Bridge configuration, origin admission, Callback composition and isolated CCDP route passed.',
)
console.info(
  'OAuth consent, token exchange, notarization and proof delivery still require the manual flow.',
)
