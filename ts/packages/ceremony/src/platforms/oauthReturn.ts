import { isClientCredential } from '../ccdp/index.js'
import { MAX_OAUTH_RETURN_CHARS } from '../ccdp/limits.js'
import { type OAuthReturn, oauthState } from '../ccdp/navigation.js'
import { messages } from '../ccdp/uiMessages.js'
import { CeremonyError } from '../errors.js'
import type { ProverContext } from './context.js'
import { ceremonyFor, type PlatformId, platforms, type SupportedCeremonyVersion } from './index.js'

/** One platform's redirect: its transport, credential field, other rejected fields and any issuer. */
export interface ReturnRules {
  transport: 'query' | 'fragment'
  credential: string
  rejected: readonly string[]
  issuer?: string
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
  if (!fields || (rules.issuer !== undefined && fields.get('iss') !== rules.issuer)) return null
  const state = fields.get('state'),
    credential = fields.get(rules.credential),
    error = fields.get('error')
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

/**
 * Admit the request against its platform's ceremony at the requested version and consume its
 * ceremony-bound return once, before any network use: null for valid denial, otherwise the
 * accepted credential.
 */
export function acceptReturn(context: ProverContext, platformId: PlatformId): string | null {
  const { request } = context
  const platform = platforms[platformId]
  context.signal.throwIfAborted()
  const ceremony = ceremonyFor(
    platformId,
    request.platformCeremonyVersion as SupportedCeremonyVersion<PlatformId>,
  )
  if (!platform.isClientId(request.clientId) || ceremony.pkce !== (request.codeVerifier !== null))
    throw new CeremonyError('authorization', messages.invalidProvingRequest)
  const returned = parseOAuthReturn(context.oauthReturn, ceremony.returnRules)
  if (returned?.state !== oauthState(context.ceremonyId))
    throw new CeremonyError('authorization', 'Invalid OAuth return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome === 'error') throw new CeremonyError('authorization', 'Authorization failed')
  if (platform.requiresClientCredential && !isClientCredential(request.clientCredential))
    throw new CeremonyError('token-fetch', 'Missing public token-exchange credential')
  return returned.credential
}
