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
import * as shared from '../src/ccdp/headers.ts'
import { popupFallback } from './popup.ts'
export const scriptHash = (code: string) =>
  `'sha256-${createHash('sha256').update(code).digest('base64')}'`
const base = shared.csp.base
export function responseHeaders(
  profile: ResponseProfile,
  {
    inline = [],
    externalOrigins = [],
  }: {
    inline?: string[]
    externalOrigins?: string[]
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(['callback', 'prefetch', 'prover', 'proverFallback'].includes(profile)
      ? shared.document
      : shared.javascript),
    ...(profile === 'asset' || ['executionWorker', 'proofWorker', 'leafWorker'].includes(profile)
      ? shared.immutable
      : { 'X-Content-Type-Options': 'nosniff' }),
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
    ? `${shared.csp.fetch} blob:`
    : execution
      ? `${shared.csp.fetch} ${shared.csp.websocket}`
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
  if (profile === 'prover') Object.assign(headers, shared.dip)
  if (profile === 'proverFallback') Object.assign(headers, shared.isolated)
  return headers
}
