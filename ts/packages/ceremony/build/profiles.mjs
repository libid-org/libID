import { popupFallback } from './popup.mjs'
import { createHash } from 'node:crypto'
export const scriptHash = (code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`
const base =
  "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
export function responseHeaders(
  profile,
  { inline = [], externalOrigins = [], notaryAddress } = {},
) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ['asset', 'executionWorker', 'proofWorker', 'leafWorker'].includes(profile)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type':
      profile === 'prefetch' || profile === 'prover' || profile === 'proverFallback'
        ? 'text/html; charset=utf-8'
        : 'text/javascript; charset=utf-8',
  }
  if (profile === 'callback')
    return {
      ...headers,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    }
  headers['Cross-Origin-Resource-Policy'] = 'same-origin'
  if (profile === 'asset') return headers
  const execution = [
    'prover',
    'proverFallback',
    'executionWorker',
    'proofWorker',
    'leafWorker',
  ].includes(profile)
  const connects = ['proofWorker', 'leafWorker'].includes(profile)
    ? 'https: blob:'
    : execution
      ? `https: ${notaryAddress.replace('https:', 'wss:')}`
      : `'self' ${externalOrigins.join(' ')}`
  headers['Content-Security-Policy'] =
    `${base}; script-src 'self' ${inline.map(scriptHash).join(' ')}${execution ? " 'wasm-unsafe-eval'" : ''}; worker-src ${profile === 'leafWorker' ? "'none'" : `'self'${execution ? ' blob:' : ''}`}; connect-src ${connects} ${popupFallback.connectSources.join(' ')}${profile === 'executionWorker' ? ' blob:' : ''}${['prefetch', 'prover', 'proverFallback'].includes(profile) ? "; style-src 'unsafe-inline'" : ''}`
  if (profile === 'worker') {
    headers['Service-Worker-Allowed'] = '/'
    return headers
  }
  if (['executionWorker', 'proofWorker', 'leafWorker'].includes(profile)) {
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
    return headers
  }
  headers['Referrer-Policy'] = 'no-referrer'
  headers['Cross-Origin-Opener-Policy'] =
    profile === 'proverFallback' ? 'same-origin' : 'unsafe-none'
  if (profile === 'prover') headers['Document-Isolation-Policy'] = 'isolate-and-require-corp'
  if (profile === 'proverFallback') headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
  return headers
}
