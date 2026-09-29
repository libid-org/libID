import { createHash, createPublicKey } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request as proxyRequest } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { packageDir } from '../build/release.ts'
import { prepareCallback } from './callback.ts'
import { makeCertificate } from './tls.mjs'

const sws = 'http://127.0.0.1:4980'

const artifactDir = join(packageDir, '.cache/qualification-assets')

const counts = new Map(),
  holds = new Map(),
  failures = new Set(),
  fixtures = new Map()

const graph = JSON.parse(readFileSync(join(artifactDir, 'distribution-graph.json')))

const html = (body) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ceremony qualification</title><body>${body}</body></html>`

const certificate = makeCertificate(['localhost'])

// Chromium's HTTP cache needs a clean certificate result, not just an ignored TLS error.
writeFileSync(
  join(packageDir, '.cache/e2e/cert-spki'),
  createHash('sha256')
    .update(createPublicKey(certificate.cert).export({ type: 'spki', format: 'der' }))
    .digest('base64'),
)

// Both schemes run the same emitted bytes and protocol tests on separate origins.
for (const secure of [true, false]) {
  const offset = secure ? 200 : 100
  const scheme = secure ? 'https' : 'http'
  const app = `${scheme}://localhost:${4681 + offset}`,
    ccdp = `${scheme}://localhost:${4683 + offset}`
  const allowedOrigins = [app, ccdp]
  const server = secure ? createServer.bind(null, certificate) : createHttpServer
  // Prepared once, independently of OAuth requests; both bytes and policy change together.
  const callback = prepareCallback(
    readFileSync(join(artifactDir, 'public/ccdp/callback.html'), 'utf8'),
    graph.headers['/ccdp/callback.html'],
    [allowedOrigins, ccdp],
  )
  // Each route returns true once it has answered; unmatched paths fall through to 404.
  const appRoute = (req, res, path, send) => {
    if (['/ui.js', '/events.js', '/google-events.js'].includes(path))
      return send(readFileSync(join(packageDir, '.cache/e2e', path.slice(1))), {
        'Content-Type': 'text/javascript',
      })
    if (path === '/ui')
      return send(
        html(
          '<main id="libid-root"></main><script type="module">import {eventView} from "/ui.js";import {Events} from "/events.js";import {progressWeights} from "/google-events.js";window.testEvents=new Events();window.testView=eventView(window.testEvents,"Google");window.testView.trackProof(progressWeights);window.testEvents.emit({event:"prover",phase:"started",timestamp:performance.timeOrigin+performance.now(),status:"active"})</script>',
        ),
      )
    if (path === '/app.js')
      return send(readFileSync(join(packageDir, '.cache/e2e/app.js')), {
        'Content-Type': 'text/javascript',
      })
    if (path === '/')
      return send(
        html(
          '<a id="launch" target="ceremony-qualification" href="#">Start ceremony</a><script type="module" src="/app.js"></script>',
        ),
      )
  }
  const bridgeRoute = (req, res, path, send) => {
    if (path === '/api/v1/ceremony/config') {
      const origin = req.headers.origin
      const admitted =
        origin === undefined
          ? req.headers['sec-fetch-site'] === 'same-origin'
          : allowedOrigins.includes(origin)
      if (!admitted) return send('Forbidden', { Vary: 'Origin, Sec-Fetch-Site' }, 403)
      return send(
        JSON.stringify({
          ccdpOrigin: ccdp,
          platforms: {
            google: {
              clientId: '407408718192.apps.googleusercontent.com',
              ceremonyVersions: [1],
            },
            x: { clientId: 'x-fixture', ceremonyVersions: [1] },
            github: {
              clientId: 'github-fixture',
              clientCredential: 'fixture-public-credential',
              ceremonyVersions: [1],
            },
          },
        }),
        {
          'Content-Type': 'application/json',
          ...(origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin }),
          Vary: 'Origin, Sec-Fetch-Site',
        },
      )
    }
    if (path === '/isolating-provider') {
      const state = new URL(req.url, app).searchParams.get('state')
      const target = `${scheme}://localhost:${4682 + offset}/auth/callback#error=access_denied&state=${encodeURIComponent(state ?? '')}`
      return send(
        html(
          `<button id="return">Return</button><script>document.querySelector('#return').onclick = () => location.replace(${JSON.stringify(target)})</script>`,
        ),
        {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      )
    }
    if (path === '/auth/callback') return send(callback.body, callback.headers)
  }
  // Tests fail, hold, release or replace individual CCDP assets and read their fetch counts.
  const qualificationControl = (req, send) => {
    const query = new URL(req.url, ccdp).searchParams,
      target = query.get('asset')
    if (query.has('fail')) failures.add(target)
    if (query.has('restore')) {
      failures.delete(target)
      fixtures.delete(target)
    }
    if (query.has('tlsn')) {
      const mode = query.get('tlsn')
      const asset = graph.allowedRequests.find(
        (asset) => asset.url === target && asset.url.endsWith('/tlsn_wasm.js'),
      )
      if (!asset || !['valid', 'invalid'].includes(mode)) return send('Invalid fixture', {}, 400)
      const code = Buffer.from(
        `globalThis.__corruptAttestation = ${mode === 'invalid'};\n` +
          readFileSync(join(packageDir, '.cache/e2e/tlsn-fixture.js'), 'utf8'),
      )
      if (code.length > asset.bytes) throw new Error('TLSN fixture exceeds asset length')
      // Keep the emitted graph's byte-length validation active. The fixture replaces
      // the SDK and peer only; production session worker/correlation code still runs.
      const body = Buffer.alloc(asset.bytes, ' ')
      code.copy(body)
      fixtures.set(target, body)
    }
    if (query.has('hold')) holds.set(target, [])
    if (query.has('release')) {
      for (const resume of holds.get(target) ?? []) resume()
      holds.delete(target)
    }
    return send(JSON.stringify({ count: counts.get(target) ?? 0 }), {
      'Content-Type': 'application/json',
    })
  }
  const ccdpRoute = async (req, res, path, send) => {
    if (path === '/qualification-control') return qualificationControl(req, send)
    if (path === '/ccdp/v1/seed') return send(html('<title>Worker seed</title>'))

    if (path === '/popup.js')
      return send(readFileSync(join(packageDir, '.cache/e2e/popup.js')), {
        'Content-Type': 'text/javascript',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
    if (path === '/after')
      return send(
        html(
          `<script type="module">import {PopupConnection,PopupWindow} from '/popup.js';const id=new URLSearchParams(location.hash.slice(1)).get('id');history.replaceState(null,'',location.pathname);const c=PopupConnection.accept(PopupWindow.current('',{scope:'/'}),{connectionId:id,allowedApplicationOrigins:['${app}']});await c.ready;c.send({type:'after'});</script>`,
        ),
        {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      )
    if (failures.has(path)) return send('Unavailable', {}, 503)
    if (Object.hasOwn(graph.headers, path)) {
      counts.set(path, (counts.get(path) ?? 0) + 1)
      if (holds.has(path)) await new Promise((resolve) => holds.get(path).push(resolve))
    }
    if (fixtures.has(path)) return send(fixtures.get(path), graph.headers[path])
    // Transparent HTTPS ingress to the real static server, including HEAD/ranges/304.
    const upstream = proxyRequest(
      new URL(req.url, sws),
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(sws).host },
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
    return true
  }
  for (const [port, route] of [
    [4681, appRoute],
    [4682, bridgeRoute],
    [4683, ccdpRoute],
  ])
    server(async (req, res) => {
      const path = new URL(req.url, 'https://localhost').pathname
      const send = (body, headers = {}, status = 200) => {
        const merged = new Headers({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        for (const [key, value] of Object.entries(headers)) merged.set(key, value)
        res.writeHead(status, Object.fromEntries(merged))
        res.end(req.method === 'HEAD' ? undefined : body)
        return true
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send('Method not allowed', {}, 405)
      try {
        if (await route(req, res, path, send)) return
      } catch {}
      send(
        '<!doctype html><title>Not found</title><p>Not found.</p>',
        { 'Content-Security-Policy': "default-src 'none'" },
        404,
      )
    }).listen(port + offset, '127.0.0.1', () =>
      console.log(`Ceremony harness listening on ${port}`),
    )
}
