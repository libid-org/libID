import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeCertificate } from './tls.mjs'
import { packageDir } from '../build/release.ts'
import { scriptHash } from '../build/profiles.ts'
const app = 'https://localhost:4681',
  bridge = 'https://localhost:4682',
  ccdp = 'https://localhost:4683'
const counts = new Map(),
  holds = new Map(),
  failures = new Set()
const graph = JSON.parse(readFileSync(join(packageDir, '.cache/distribution-graph.json'))),
  cert = makeCertificate(['localhost'])
const html = (body) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ceremony qualification</title><body>${body}</body></html>`
const bootstrap = `(()=>{const input={query:location.search,fragment:location.hash};history.replaceState(null,'',location.pathname);try{if(input.query.length+input.fragment.length>32768)throw new Error();const states=[...new URLSearchParams(input.query).getAll('state'),...new URLSearchParams(input.fragment.slice(1)).getAll('state')];if(states.length!==1||!/^v1\\.[0-9a-f-]+$/.test(states[0]))throw new Error();Object.freeze(input);import('${ccdp}/ccdp/v1/callback.js').then(m=>m.startCallback(input,Object.freeze(['${app}']),'${ccdp}')).catch(fail)}catch{fail()}function fail(){document.getElementById('libid-root').textContent='Unable to continue.'}})()`
const callbackPolicy = `default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; script-src ${scriptHash(bootstrap)} ${ccdp}/ccdp/v1/callback.js; style-src 'unsafe-inline'; frame-src ${ccdp}`
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
        if (path === '/callback')
          return send(html(`<main id="libid-root"></main><script>${bootstrap}</script>`), {
            'Content-Security-Policy': callbackPolicy,
            'Cross-Origin-Opener-Policy': 'unsafe-none',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          })
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
          if (process.env.CEREMONY_SWS_URL) {
            const response = await fetch(process.env.CEREMONY_SWS_URL + req.url, {
              headers: { 'Accept-Encoding': 'identity' },
            })
            const headers = Object.fromEntries(response.headers)
            delete headers['content-length']
            delete headers['transfer-encoding']
            return send(Buffer.from(await response.arrayBuffer()), headers, response.status)
          }
          const physical = path === '/ccdp/v1/prover' ? `${path}/index.html` : path
          return send(
            readFileSync(join(packageDir, 'dist-artifacts/public', physical)),
            graph.headers[path],
          )
        }
      }
    } catch {}
    send(
      '<!doctype html><title>Not found</title><p>Not found.</p>',
      { 'Content-Security-Policy': "default-src 'none'" },
      404,
    )
  }).listen(port, '127.0.0.1', () => console.log(`Ceremony harness listening on ${port}`))
