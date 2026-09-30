import { MAX_CEREMONY_VERSION } from '../platforms/authorization.js'
import { isOrigin, isSlug, isUint } from '../primitives.js'
import { CCDP_VERSION, UUID } from './index.js'
import { MAX_NAVIGATION_FRAGMENT_CHARS } from './limits.js'

export interface OAuthReturn {
  query: string
  fragment: string
}

export const route = (name: 'prefetch' | 'prover' | 'prover/fallback' | 'worker.js') =>
  `/ccdp/v${CCDP_VERSION}/${name}`

export const oauthState = (ceremonyId: string) => `v${CCDP_VERSION}.${ceremonyId}`

/** Any CCDP version parses, so Callback can reject unbundled ones distinctly from malformed state. */
export function readOAuthState(state: string): { version: string; ceremonyId: string } | null {
  const match = /^v([1-9][0-9]*)\.(.+)$/.exec(state)
  return match && UUID.test(match[2]) ? { version: match[1], ceremonyId: match[2] } : null
}

function fields<K extends string>(fragment: string, keys: readonly K[]): Record<K, string> {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (raw.length > MAX_NAVIGATION_FRAGMENT_CHARS) throw new TypeError('Navigation input too large')
  // URLSearchParams is deliberately forgiving; reject malformed UTF-8/escapes first.
  decodeURIComponent(raw.replace(/\+/g, ' '))
  const p = new URLSearchParams(raw)
  if (p.size !== keys.length || keys.some((k) => p.getAll(k).length !== 1))
    throw new TypeError('Invalid navigation fields')
  return Object.fromEntries(p) as Record<K, string>
}

export function prefetchFragment(
  ceremonyId: string,
  platformId: string,
  version: number,
): URLSearchParams {
  return new URLSearchParams({ ceremonyId, platformId, ceremonyVersion: String(version) })
}

export function readPrefetch(fragment: string) {
  const {
    ceremonyId,
    platformId,
    ceremonyVersion: version,
  } = fields(fragment, ['ceremonyId', 'platformId', 'ceremonyVersion'])
  if (
    !UUID.test(ceremonyId) ||
    !isSlug(platformId) ||
    !/^(0|[1-9][0-9]*)$/.test(version) ||
    !isUint(Number(version), MAX_CEREMONY_VERSION)
  )
    throw new TypeError('Invalid Prefetch input')
  return { ceremonyId, platformId, platformCeremonyVersion: Number(version) }
}

export function proverFragment(
  ceremonyId: string,
  applicationOrigin: string,
  input: OAuthReturn,
): URLSearchParams {
  return new URLSearchParams({
    ceremonyId,
    applicationOrigin,
    oauthQuery: input.query,
    oauthFragment: input.fragment,
  })
}

export function readProver(fragment: string) {
  const {
    ceremonyId,
    applicationOrigin,
    oauthQuery: query,
    oauthFragment: hash,
  } = fields(fragment, ['ceremonyId', 'applicationOrigin', 'oauthQuery', 'oauthFragment'])
  if (
    !UUID.test(ceremonyId) ||
    !isOrigin(applicationOrigin) ||
    (query !== '' && !query.startsWith('?')) ||
    (hash !== '' && !hash.startsWith('#'))
  )
    throw new TypeError('Invalid Prover input')
  return { ceremonyId, applicationOrigin, oauthReturn: { query, fragment: hash } }
}
