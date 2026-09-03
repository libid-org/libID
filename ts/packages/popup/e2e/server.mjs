// Three genuinely cross-site origins: an allowed application, an unlisted
// application, and the popup origin with a participating page, an isolated
// participating page, a non-participating page, and the worker script.
// The page scripts are the smallest caller protocol that exercises every
// documented path; they own nothing the package cares about.

import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeCertificate } from './tls.mjs'

// Two popup origins on different sites so a participating document can be
// replaced by one on another site.
export const ORIGINS = {
  appA: 'https://app-a.lvh.me:4581',
  appB: 'https://app-b.local.gd:4582',
  popup: 'https://popup.localtest.me:4583',
  popupB: 'https://popup-b.lvh.me:4584',
}

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist')
const popupModule = readFileSync(join(dist, 'popup.js'))
const workerModule = readFileSync(join(dist, 'sw.js'))

// Test protocol: Ping (app → popup), Pong (popup → app), Go (app → popup,
// asks the popup to navigate itself).
const protocol = `
  const message = (type, decode) => ({ type, decode })
  const Ping = message('ping', (v) => { if (typeof v.n !== 'number') throw new Error('ping'); return v })
  const Pong = message('pong', (v) => { if (typeof v.n !== 'number') throw new Error('pong'); return v })
  const Go = message('go', (v) => { if (typeof v.url !== 'string') throw new Error('go'); return v })
  const Away = message('away', (v) => { if (typeof v.url !== 'string') throw new Error('away'); return v })
  window.__events = []
  window.__diag = []
  const onDiagnostic = (d) => window.__diag.push(d.code)
`

const html = (body) => `<!doctype html><meta charset="utf-8"><title>popup e2e</title>${body}`

const appPage = html(`
  <a id="go" href="${ORIGINS.popup}/p" target="libid-popup">open</a>
  <script type="module">
    import { PopupConnection, PopupWindow } from '/popup.js'
    ${protocol}
    // Capture the raw handle so the spec can qualify \`closed\` after COOP.
    const realOpen = window.open.bind(window)
    window.open = (...args) => (window.__handle = realOpen(...args))
    const anchor = document.getElementById('go')
    anchor.addEventListener('click', (event) => {
      const popupWindow = PopupWindow.open(anchor.target)
      const connection = PopupConnection.connect(popupWindow, {
        connectionId: window.__id,
        allowedPopupOrigins: ['${ORIGINS.popup}', '${ORIGINS.popupB}'],
        onDiagnostic,
      })
      connection.on(Pong, (pong) => window.__events.push(pong))
      window.__conn = connection
      window.__popupWindow = popupWindow
      connection.closed.then((end) => window.__events.push({ type: 'end', ...end }))
      void connection.navigate(anchor.href).catch((error) => window.__events.push({ type: 'error', code: error.message }))
      if (popupWindow.opened) event.preventDefault()
    })
  </script>
`)

const popupPage = html(`
  <p id="status">popup</p>
  <script type="module">
    import { PopupConnection, PopupWindow } from '/popup.js'
    ${protocol}
    const id = new URLSearchParams(location.hash.slice(1)).get('c') ?? ''
    window.__isolated = crossOriginIsolated
    // /p-any is the same document deployed for any opener origin.
    const allowedApplicationOrigins = location.pathname === '/p-any' ? '*' : ['${ORIGINS.appA}']
    // Accept first: the claim must run before any other network work, and
    // handlers registered before yielding precede every delivery.
    const connection = PopupConnection.accept(PopupWindow.current(), {
      connectionId: id,
      allowedApplicationOrigins,
      onDiagnostic,
    })
    window.__conn = connection
    connection.closed.then((end) => window.__events.push({ type: 'end', ...end }))
    // The host registers the worker in every participating document.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    try {
      connection.on(Ping, (ping) => {
        window.__events.push(ping)
        connection.send({ type: 'pong', n: ping.n, path: location.pathname, isolated: crossOriginIsolated })
      })
      connection.on(Go, (go) => {
        connection.navigate(go.url).catch((error) => window.__events.push({ type: 'error', code: error.message }))
      })
      connection.on(Away, (away) => {
        connection.navigateAway(away.url).catch((error) => window.__events.push({ type: 'error', code: error.message }))
      })
      await connection.ready
      connection.send({ type: 'pong', n: 0, path: location.pathname, isolated: crossOriginIsolated })
      document.getElementById('status').textContent = 'connected'
    } catch (error) {
      window.__events.push({ type: 'error', code: error.message })
      document.getElementById('status').textContent = 'failed: ' + error.message
    }
  </script>
`)

// Non-participating: like a provider page, it eventually sends the user
// back to a participating document without touching the package.
const externalPage = html(`
  <p id="status">external</p>
  <script>
    const params = new URLSearchParams(location.search)
    const next = params.get('next')
    const delay = Number(params.get('delay') ?? '0')
    if (next) setTimeout(() => location.replace(next), delay)
  </script>
`)

const send = (res, status, headers, body) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

const HTML = { 'Content-Type': 'text/html; charset=utf-8' }
const JS = { 'Content-Type': 'text/javascript; charset=utf-8' }
const ISOLATED = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

function popupHandler(req, res) {
  const url = new URL(req.url, 'https://popup.invalid')
  switch (url.pathname) {
    case '/health':
      return send(res, 200, {}, 'ok')
    case '/popup.js':
      return send(res, 200, JS, popupModule)
    case '/sw.js':
      return send(res, 200, { ...JS, 'Service-Worker-Allowed': '/' }, workerModule)
    case '/p':
    case '/p-any':
      return send(res, 200, { ...HTML, 'Cross-Origin-Opener-Policy': 'unsafe-none' }, popupPage)
    case '/isolated':
      return send(res, 200, { ...HTML, ...ISOLATED }, popupPage)
    case '/external':
      return send(res, 200, HTML, externalPage)
    default:
      return send(res, 404, {}, '')
  }
}

function appHandler(req, res) {
  const url = new URL(req.url, ORIGINS.appA)
  if (url.pathname === '/popup.js') return send(res, 200, JS, popupModule)
  if (url.pathname === '/') return send(res, 200, HTML, appPage)
  return send(res, 404, {}, '')
}

const tls = makeCertificate(Object.values(ORIGINS).map((origin) => new URL(origin).hostname))
for (const [origin, handler] of [
  [ORIGINS.popup, popupHandler],
  [ORIGINS.popupB, popupHandler],
  [ORIGINS.appA, appHandler],
  [ORIGINS.appB, appHandler],
]) {
  createServer(tls, handler).listen(Number(new URL(origin).port))
}
