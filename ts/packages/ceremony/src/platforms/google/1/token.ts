import { PLATFORM_GOOGLE_KEY } from '@libid/contracts/platforms'
import type { OidcGoogleToken } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { MAX_AUD_BYTES } from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { CeremonyError } from '../../../errors.js'
import { isAccountId, isHandle } from '../../../identity.js'
import { b64urlDecode, isUint } from '../../../primitives.js'
import { fetchSigningKey as fetchKey, jsonObject as json, rs256Kid } from '../../oidc.js'
import { isAudience } from '../../oidcValidation.js'
import { provider } from './provider.js'

/** The token bytes and claims the fixed oidc_google circuit consumes, plus the signing key's `kid`. */
export interface ParsedGoogleIdToken extends OidcGoogleToken {
  kid: string
}

const isClaim = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The circuit also requires the fixed issuer and a verified email; neither is delivered. */
function googleClaims(p: Record<string, unknown> | null): OidcGoogleToken['claims'] | null {
  if (p?.iss !== provider.issuer || p.email_verified !== true) return null
  const { aud, sub, email, exp, nonce } = p
  return isClaim(aud) &&
    isClaim(sub) &&
    isClaim(email) &&
    isUint(exp, Number.MAX_SAFE_INTEGER) &&
    isClaim(nonce)
    ? { aud, sub, email, exp, nonce }
    : null
}

/**
 * The released circuit's claim widths and characters: the platform table's id and handle checks
 * for `sub` and `email`. buildOidcGoogleInputs bounds the payload and signing input.
 */
const fitsCircuit = ({ aud, sub, email }: OidcGoogleToken['claims']) =>
  isAudience(aud, MAX_AUD_BYTES) &&
  isAccountId(PLATFORM_GOOGLE_KEY, sub) &&
  isHandle(PLATFORM_GOOGLE_KEY, email)

/** Parse the fixed RS256 token layout; any failure is an authorization error. */
function parseGoogleIdToken(idToken: string): ParsedGoogleIdToken {
  const segments = idToken.split('.')
  const [headerB64, payloadB64] = segments
  const [header, payload, signature] =
    segments.length === 3 && !segments.includes('') ? segments.map(b64urlDecode) : []
  const claims = payload && googleClaims(json(payload))
  if (!header || !payload || !signature || !claims)
    throw new CeremonyError('authorization', 'invalid Google ID token')
  const kid = rs256Kid(json(header))
  if (!kid) throw new CeremonyError('authorization', 'invalid Google ID token header')
  if (!fitsCircuit(claims))
    throw new CeremonyError(
      'authorization',
      'Google account identifiers exceed the lengths or characters the circuit supports',
    )
  return { kid, headerB64, payload, payloadB64, signature, claims }
}

/** Accept a token only for this ceremony's client and before its signed expiry. */
export function acceptGoogleIdToken(idToken: string, clientId: string): ParsedGoogleIdToken {
  const token = parseGoogleIdToken(idToken)
  if (token.claims.aud !== clientId || token.claims.exp <= Date.now() / 1000)
    throw new CeremonyError('authorization', 'Invalid Google token')
  return token
}

/** Select the one published signing key carrying the token's `kid`. */
export const fetchSigningKey = (kid: string, signal: AbortSignal) =>
  fetchKey(provider.jwksUrl, kid, signal)
