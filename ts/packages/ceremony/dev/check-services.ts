// Read-only pre-consent checks. No OAuth credentials or provider calls.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { request } from 'node:https'
const bridge = 'https://localhost:4682'
const ccdp = 'https://localhost:4683'
const notary = 'https://localhost:4687'
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
const info = await fetch(`${notary}/info`)
assert.equal(info.status, 200)
assert.match((await info.json()).publicKey, /^(0x)?0[23][0-9a-f]{64}$/i)
// A real WebSocket handshake through HTTPS, without spending an OAuth code.
await new Promise<void>((resolve, reject) => {
  const key = randomBytes(16).toString('base64')
  const probe = request(`${notary}/notarize-proxy`, {
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key,
    },
  })
  const timeout = setTimeout(() => probe.destroy(new Error('Notary WebSocket timeout')), 10_000)
  probe.on('error', reject)
  probe.on('close', () => clearTimeout(timeout))
  probe.on('response', (reply) => {
    reply.resume()
    probe.destroy(new Error(`Notary refused WebSocket upgrade: ${reply.statusCode}`))
  })
  probe.on('upgrade', (reply, socket) => {
    // No TLSNotary protocol is sent; explicitly release this readiness socket.
    socket.destroy()
    clearTimeout(timeout)
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    if (reply.statusCode !== 101 || reply.headers['sec-websocket-accept'] !== accept)
      reject(new Error('Invalid notary WebSocket handshake'))
    else resolve()
  })
  probe.end()
})
console.info(
  'Bridge configuration, origin admission, Callback composition, isolated CCDP route and notary HTTPS/WebSocket passed.',
)
console.info(
  'OAuth consent, token exchange, notarization and proof delivery still require the manual flow.',
)
