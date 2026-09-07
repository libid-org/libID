import { CCDP_VERSION, PLATFORM, uint, UUID } from './index.js'
export interface OAuthReturn {
  query: string
  fragment: string
}
export const route = (name: 'prefetch' | 'prover' | 'prover/fallback' | 'worker.js') =>
  `/ccdp/v${CCDP_VERSION}/${name}`
export const oauthState = (ceremonyId: string) => `v${CCDP_VERSION}.${ceremonyId}`
function fields(fragment: string, keys: string[]): URLSearchParams {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (raw.length > 65536) throw new TypeError('Navigation input too large')
  // URLSearchParams is deliberately forgiving; reject malformed UTF-8/escapes first.
  decodeURIComponent(raw.replace(/\+/g, ' '))
  const p = new URLSearchParams(raw)
  if (p.size !== keys.length || keys.some((k) => p.getAll(k).length !== 1))
    throw new TypeError('Invalid navigation fields')
  return p
}
export function prefetchFragment(
  ceremonyId: string,
  platformId: string,
  version: number,
): URLSearchParams {
  return new URLSearchParams({ ceremonyId, platformId, ceremonyVersion: String(version) })
}
export function readPrefetch(fragment: string) {
  const p = fields(fragment, ['ceremonyId', 'platformId', 'ceremonyVersion'])
  const ceremonyId = p.get('ceremonyId')!,
    platformId = p.get('platformId')!,
    version = p.get('ceremonyVersion')!
  if (
    !UUID.test(ceremonyId) ||
    !PLATFORM.test(platformId) ||
    !/^(0|[1-9][0-9]*)$/.test(version) ||
    !uint(Number(version), 65535)
  )
    throw new TypeError('Invalid Prefetch input')
  return { ceremonyId, platformId, platformCeremonyVersion: Number(version) }
}
export function proverFragment(ceremonyId: string, input: OAuthReturn): URLSearchParams {
  return new URLSearchParams({ ceremonyId, oauthQuery: input.query, oauthFragment: input.fragment })
}
export function readProver(fragment: string) {
  const p = fields(fragment, ['ceremonyId', 'oauthQuery', 'oauthFragment'])
  const ceremonyId = p.get('ceremonyId')!,
    query = p.get('oauthQuery')!,
    hash = p.get('oauthFragment')!
  if (
    !UUID.test(ceremonyId) ||
    (query !== '' && !query.startsWith('?')) ||
    (hash !== '' && !hash.startsWith('#'))
  )
    throw new TypeError('Invalid Prover input')
  return { ceremonyId, oauthReturn: { query, fragment: hash } }
}
