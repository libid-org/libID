export type ResponseProfile =
  | 'prefetch'
  | 'prover'
  | 'proverFallback'
  | 'callback'
  | 'worker'
  | 'executionWorker'
  | 'proofWorker'
  | 'leafWorker'
  | 'asset'

import { createHash } from 'node:crypto'
import { popupFallback } from './popup.ts'
export const scriptHash = (code: string) =>
  `'sha256-${createHash('sha256').update(code).digest('base64')}'`
const base =
  "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
export function responseHeaders(
  profile: ResponseProfile,
  {
    inline = [],
    externalOrigins = [],
    notaryAddress,
  }: {
    inline?: string[]
    externalOrigins?: string[]
    notaryAddress: string
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ['asset', 'executionWorker', 'proofWorker', 'leafWorker'].includes(profile)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type': ['callback', 'prefetch', 'prover', 'proverFallback'].includes(profile)
      ? 'text/html; charset=utf-8'
      : 'text/javascript; charset=utf-8',
  }
  if (profile === 'callback')
    return {
      ...headers,
      'Content-Security-Policy': `${base}; script-src ${inline.map(scriptHash).join(' ')}; style-src 'unsafe-inline'`,
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Referrer-Policy': 'no-referrer',
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
