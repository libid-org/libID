export type ResponseProfile =
  | 'prefetch'
  | 'prover'
  | 'proverFallback'
  | 'callback'
  | 'worker'
  | 'notaryWorker'
  | 'proofWorker'
  | 'leafWorker'
  | 'asset'
  | 'versions'

import { createHash } from 'node:crypto'
import * as shared from '../src/assets/headers.ts'
import { popupFallback } from './popup.ts'

export const scriptHash = (code: string) =>
  `'sha256-${createHash('sha256').update(code).digest('base64')}'`

/** Directive name (lowercase) to its sources; a repeated directive is rejected, not ignored. */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const clause of policy.split(';')) {
    const [name, ...sources] = clause.trim().split(/\s+/)
    if (!name) continue
    if (directives.has(name.toLowerCase())) throw new Error('Duplicate CSP directive')
    directives.set(name.toLowerCase(), sources)
  }
  return directives
}

const base = shared.csp.base

const documents: readonly ResponseProfile[] = ['callback', 'prefetch', 'prover', 'proverFallback']

/** Revalidated scripts; documents already declare both in `shared.document`. */
const revalidated = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }

/** Bundled workers under COEP; the notary session worker alone connects to notaries. */
export const isolatedWorkers: readonly ResponseProfile[] = [
  'notaryWorker',
  'proofWorker',
  'leafWorker',
]

export function responseHeaders(
  profile: ResponseProfile,
  {
    inline = [],
    externalOrigins = [],
  }: {
    inline?: string[]
    externalOrigins?: string[]
  } = {},
): Record<string, string> {
  const html = documents.includes(profile),
    immutable = profile === 'asset' || isolatedWorkers.includes(profile)
  const headers: Record<string, string> = {
    ...(html ? shared.document : shared.javascript),
    ...(immutable ? shared.immutable : revalidated),
  }
  if (profile === 'callback')
    return {
      ...headers,
      'Content-Security-Policy': `${base}; script-src ${inline.map(scriptHash).join(' ')}; style-src 'unsafe-inline'`,
    }
  // The Application reads the version list from its own origin; the wildcard needs no Vary.
  if (profile === 'versions')
    return {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    }
  headers['Cross-Origin-Resource-Policy'] = 'same-origin'
  if (profile === 'asset') return headers
  headers['Content-Security-Policy'] = executableCsp(profile, inline, externalOrigins)
  if (profile === 'worker') headers['Service-Worker-Allowed'] = '/'
  if (isolatedWorkers.includes(profile)) headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
  if (profile === 'prover') Object.assign(headers, shared.dip)
  if (profile === 'proverFallback') Object.assign(headers, shared.isolated)
  return headers
}

/** Script, worker and connection sources for every executable profile except Callback. */
function executableCsp(
  profile: ResponseProfile,
  inline: string[],
  externalOrigins: string[],
): string {
  const execution =
    profile === 'prover' || profile === 'proverFallback' || isolatedWorkers.includes(profile)
  const scripts = `'self' ${inline.map(scriptHash).join(' ')}${execution ? " 'wasm-unsafe-eval'" : ''}`,
    workers = profile === 'leafWorker' ? "'none'" : `'self'${execution ? ' blob:' : ''}`
  const connects =
    profile === 'proofWorker' || profile === 'leafWorker'
      ? `${shared.csp.fetch} blob:`
      : execution
        ? `${shared.csp.fetch} ${shared.csp.websocket}`
        : `'self' ${externalOrigins.join(' ')}`
  const connectBlob = profile === 'notaryWorker' ? ' blob:' : '',
    styles = documents.includes(profile) ? "; style-src 'unsafe-inline'" : ''
  return `${base}; script-src ${scripts}; worker-src ${workers}; connect-src ${connects} ${popupFallback.connectSources.join(' ')}${connectBlob}${styles}`
}
