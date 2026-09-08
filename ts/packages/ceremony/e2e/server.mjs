import { readFileSync } from 'node:fs'
import { request as proxyRequest } from 'node:http'
import { createServer } from 'node:https'
import { join } from 'node:path'
import { packageDir } from '../build/release.ts'
import { prepareCallback } from './callback.ts'
import { makeCertificate } from './tls.mjs'

const app = 'https://localhost:4681',
  bridge = 'https://localhost:4682',
  ccdp = 'https://localhost:4683'
const sws = process.env.CEREMONY_SWS_URL
if (!sws)
  throw new Error(
    'CEREMONY_SWS_URL must point to the pinned SWS serving the qualification artifact',
  )
const artifactDir = join(packageDir, '.cache/qualification-assets')
const counts = new Map(),
  holds = new Map(),
  failures = new Set()
const graph = JSON.parse(readFileSync(join(artifactDir, 'distribution-graph.json'))),
  cert = makeCertificate(['localhost'])
const html = (body) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ceremony qualification</title><body>${body}</body></html>`
// Prepared once, independently of OAuth requests; both bytes and policy change together.
const callback = prepareCallback(
  readFileSync(join(artifactDir, 'public/ccdp/callback.html'), 'utf8'),
  graph.headers['/ccdp/callback.html'],
  [[app], ccdp],
)
for (const port of [4681, 4682, 4683])
  createServer(cert, async (req, res) => {
    const path = new URL(req.url, 'https://localhost').pathname
    const send = (body, headers = {}, status = 200) => {
      const merged = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      for (const [key, value] of Object.entries(headers)) merged.set(key, value)
      res.writeHead(status, Object.fromEntries(merged))
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      send('Method not allowed', {}, 405)
      return
    }
    try {
      if (port === 4681) {
        if (path === '/ui.js')
          return send(readFileSync(join(packageDir, '.cache/e2e/ui.js')), {
            'Content-Type': 'text/javascript',
          })
        if (path === '/ui')
          return send(
            html(
              '<main id="libid-root"></main><script type="module">import {progressView} from "/ui.js";window.testProgress=progressView()</script>',
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
      if (port === 4682) {
        if (path === '/api/v1/ceremony/config')
          return send(
            JSON.stringify({
              ccdpOrigin: ccdp,
              redirectUri: `${bridge}/callback`,
              platforms: {
                google: {
                  clientId: '407408718192.apps.googleusercontent.com',
                  ceremonyVersions: [1],
                },
              },
            }),
            { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          )
        if (path === '/callback') return send(callback.body, callback.headers)
      }
      if (port === 4683) {
        if (path === '/qualification-control') {
          const query = new URL(req.url, ccdp).searchParams,
            target = query.get('asset')
          if (query.has('fail')) failures.add(target)
          if (query.has('restore')) failures.delete(target)
          if (query.has('hold')) holds.set(target, [])
          if (query.has('release')) {
            for (const resume of holds.get(target) ?? []) resume()
            holds.delete(target)
          }
          return send(JSON.stringify({ count: counts.get(target) ?? 0 }), {
            'Content-Type': 'application/json',
          })
        }
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
        return
      }
    } catch {}
    send(
      '<!doctype html><title>Not found</title><p>Not found.</p>',
      { 'Content-Security-Policy': "default-src 'none'" },
      404,
    )
  }).listen(port, '127.0.0.1', () => console.log(`Ceremony harness listening on ${port}`))
