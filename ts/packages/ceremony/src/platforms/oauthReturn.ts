import { isClientCredential } from '../ccdp/index.js'
import { type OAuthReturn, oauthState } from '../ccdp/navigation.js'
import { CeremonyError } from '../errors.js'
import type { ProverContext } from './context.js'
import { type PlatformId, platforms } from './index.js'

/** One platform's redirect: its transport, credential field, other rejected fields and any issuer. */
export interface ReturnProfile {
  transport: 'query' | 'fragment'
  credential: string
  rejected: readonly string[]
  issuer?: string
}

export type OAuthOutcome =
  | { outcome: 'accepted'; state: string; credential: string }
  | { outcome: 'denied'; state: string }
  | { outcome: 'error'; state: string; error: string }

// Names are matched exactly, never percent-decoded; raw values are printable.
const FIELD = /^([A-Za-z0-9_.-]{1,64})=([\x20-\x7e]*)$/

const VALUE = /^[\x20-\x7e]+$/

const isValue = (value: string | undefined): value is string =>
  value !== undefined && VALUE.test(value)

/** Decode provider form values without requiring one particular percent-encoding spelling. */
function readFields(component: string, rejected: readonly string[]): Map<string, string> | null {
  const fields = new Map<string, string>()
  for (const part of component.split('&')) {
    const [, key, raw] = FIELD.exec(part) ?? []
    if (key === undefined || rejected.includes(key) || fields.has(key)) return null
    let value: string
    try {
      value = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
      return null
    }
    if (value.length > 8192) return null
    fields.set(key, value)
  }
  return fields
}

/**
 * Parse one exact return: `state` plus the credential XOR `error`. Other bounded provider
 * metadata has no value schema; only fields used by the profile are interpreted.
 */
export function parseOAuthReturn(
  oauthReturn: OAuthReturn,
  profile: ReturnProfile,
): OAuthOutcome | null {
  const query = profile.transport === 'query'
  const [component, other] = query
    ? [oauthReturn.query, oauthReturn.fragment]
    : [oauthReturn.fragment, oauthReturn.query]
  if (other !== '' || component[0] !== (query ? '?' : '#') || component.length > 32768) return null
  const fields = readFields(component.slice(1), profile.rejected)
  if (!fields || (profile.issuer !== undefined && fields.get('iss') !== profile.issuer)) return null
  const state = fields.get('state'),
    credential = fields.get(profile.credential),
    error = fields.get('error')
  if (!isValue(state) || (credential === undefined) === (error === undefined)) return null
  if (credential !== undefined)
    return isValue(credential) ? { outcome: 'accepted', state, credential } : null
  if (!isValue(error)) return null
  return error === 'access_denied'
    ? { outcome: 'denied', state }
    : { outcome: 'error', state, error }
}

/**
 * Admit the request against its catalog entry and consume its ceremony-bound return once,
 * before any network use: null for valid denial, otherwise the accepted credential.
 */
export function acceptReturn(context: ProverContext, platformId: PlatformId): string | null {
  const { request } = context
  const platform = platforms[platformId],
    version = platform.versions[1]
  context.signal.throwIfAborted()
  if (!platform.isClientId(request.clientId) || version.pkce !== (request.codeVerifier !== null))
    throw new CeremonyError('authorization', 'Invalid proving request')
  const returned = parseOAuthReturn(context.oauthReturn, version.oauthReturn)
  if (returned?.state !== oauthState(context.ceremonyId))
    throw new CeremonyError('authorization', 'Invalid OAuth return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome === 'error') throw new CeremonyError('authorization', 'Authorization failed')
  if (platform.requiresClientCredential && !isClientCredential(request.clientCredential))
    throw new CeremonyError('token-fetch', 'Missing public token-exchange credential')
  return returned.credential
}
