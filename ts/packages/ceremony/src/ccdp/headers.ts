/** Response policy only. The static server owns representation metadata. */
const base =
  "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
export const csp = {
  base,
  // Exact loopback hosts only; public destinations still require TLS.
  fetch: 'https: http://localhost:* http://127.0.0.1:*',
  websocket: 'wss: ws://localhost:* ws://127.0.0.1:*',
  execution: `${base}; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:`,
} as const
export const immutable = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const
export const javascript = { 'Content-Type': 'text/javascript; charset=utf-8' } as const
export const wasm = { 'Content-Type': 'application/wasm' } as const
export const json = { 'Content-Type': 'application/json' } as const
export const document = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'unsafe-none',
  'Content-Security-Policy': base,
} as const
export const executionWorker = {
  ...javascript,
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Content-Security-Policy': `${csp.execution}; connect-src ${csp.fetch} blob:`,
} as const
export const dip = { 'Document-Isolation-Policy': 'isolate-and-require-corp' } as const
export const isolated = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const
