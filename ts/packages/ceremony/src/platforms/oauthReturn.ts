import { isClientCredential, type ProveIdentity } from '../ccdp/index.js'
import { MAX_OAUTH_RETURN_CHARS } from '../ccdp/limits.js'
import { type OAuthReturn, oauthState } from '../ccdp/navigation.js'
import { messages } from '../ccdp/uiMessages.js'
import { CeremonyError } from '../errors.js'
import { ceremonyFor, type PlatformId, platforms, type SupportedCeremonyVersion } from './index.js'

/** One platform's redirect: its transport, credential field, other rejected fields and any issuer. */
export interface ReturnRules {
  transport: 'query' | 'fragment'
  credentialField: string
  rejected: readonly string[]
  authorizationIssuer?: string
  /** The credential values the platform can exchange, checked at the redirect. */
  isCredential?: (value: string) => boolean
}

export type OAuthOutcome =
  | { outcome: 'accepted'; state: string; credential: string }
  | { outcome: 'denied'; state: string }
  | { outcome: 'error'; state: string; error: string }

const MAX_FIELD_NAME_CHARS = 64
const MAX_FIELD_VALUE_CHARS = 8192

// Names are matched exactly, never percent-decoded; raw values are printable.
const FIELD = /^([A-Za-z0-9_.-]+)=([\x20-\x7e]*)$/

const VALUE = /^[\x20-\x7e]+$/

const isValue = (value: string | undefined): value is string =>
  value !== undefined && VALUE.test(value)

/** Decode provider form values without requiring one particular percent-encoding spelling. */
function readFields(component: string, rejected: readonly string[]): Map<string, string> | null {
  const fields = new Map<string, string>()
  for (const part of component.split('&')) {
    const [, key, raw] = FIELD.exec(part) ?? []
    if (
      key === undefined ||
      key.length > MAX_FIELD_NAME_CHARS ||
      rejected.includes(key) ||
      fields.has(key)
    )
      return null
    let value: string
    try {
      value = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
      return null
    }
    if (value.length > MAX_FIELD_VALUE_CHARS) return null
    fields.set(key, value)
  }
  return fields
}

/**
 * Parse one exact return: `state` plus the credential XOR `error`. Other bounded provider
 * metadata has no value schema; only fields the rules use are interpreted.
 */
export function parseOAuthReturn(
  oauthReturn: OAuthReturn,
  rules: ReturnRules,
): OAuthOutcome | null {
  const query = rules.transport === 'query'
  const [component, other] = query
    ? [oauthReturn.query, oauthReturn.fragment]
    : [oauthReturn.fragment, oauthReturn.query]
  if (
    other !== '' ||
    component[0] !== (query ? '?' : '#') ||
    component.length > MAX_OAUTH_RETURN_CHARS
  )
    return null
  const fields = readFields(component.slice(1), rules.rejected)
  if (
    !fields ||
    (rules.authorizationIssuer !== undefined && fields.get('iss') !== rules.authorizationIssuer)
  )
    return null
  const state = fields.get('state')
  const credential = fields.get(rules.credentialField)
  const error = fields.get('error')
  if (!isValue(state) || (credential === undefined) === (error === undefined)) return null
  if (credential !== undefined)
    return isValue(credential) && (rules.isCredential?.(credential) ?? true)
      ? { outcome: 'accepted', state, credential }
      : null
  if (!isValue(error)) return null
  return error === 'access_denied'
    ? { outcome: 'denied', state }
    : { outcome: 'error', state, error }
}

/** An admitted return's credential, with the request's verifier where the version declares PKCE. */
export interface AcceptedReturn {
  credential: string
  codeVerifier: string | null
}

/**
 * Admit `request` against platform `platformId`'s ceremony at `version` and read the run's
 * ceremony-bound return, before any network use: null for valid denial, otherwise the accepted
 * credential. Consuming the return once is the Prover document's job.
 */
export function acceptReturn<P extends PlatformId>(
  platformId: P,
  version: SupportedCeremonyVersion<P>,
  request: ProveIdentity,
  capture: { ceremonyId: string; oauthReturn: OAuthReturn },
): AcceptedReturn | null {
  const platform = platforms[platformId]
  const ceremony = ceremonyFor(platformId, version)
  if (!platform.isClientId(request.clientId) || ceremony.pkce !== (request.codeVerifier !== null))
    throw new CeremonyError('authorization', messages.invalidProvingRequest)
  const returned = parseOAuthReturn(capture.oauthReturn, ceremony.returnRules)
  if (returned?.state !== oauthState(capture.ceremonyId))
    throw new CeremonyError('authorization', 'Invalid OAuth return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome === 'error') throw new CeremonyError('authorization', 'Authorization failed')
  if (platform.requiresClientCredential && !isClientCredential(request.clientCredential))
    throw new CeremonyError('token-fetch', 'Missing public token-exchange credential')
  return { credential: returned.credential, codeVerifier: request.codeVerifier }
}
