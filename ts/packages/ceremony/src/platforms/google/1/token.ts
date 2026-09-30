import type { GoogleCircuitToken } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { CeremonyError } from '../../../errors.js'
import { b64urlDecode, isRecord, isUint } from '../../../primitives.js'
import { readJson } from '../../../response.js'
import { provider } from './provider.js'
import { isCircuitText } from './validation.js'

/** The token bytes and claims the fixed oidc_google circuit consumes, plus the signing key's `kid`. */
export interface ParsedGoogleIdToken extends GoogleCircuitToken {
  kid: string
}

/** Bound a public JWKS response independently of the circuit's token dimensions. */
const MAX_JWKS_BYTES = 128 * 1024

const text = new TextDecoder('utf-8', { fatal: true })

function json(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text.decode(bytes))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** The circuit also requires the fixed issuer and a verified email; neither is delivered. */
function googleClaims(p: Record<string, unknown> | null): GoogleCircuitToken['claims'] | null {
  if (p?.iss !== provider.issuer || p.email_verified !== true) return null
  const { aud, sub, email, exp, nonce } = p
  return isCircuitText(aud, MAX_AUD_BYTES) &&
    isCircuitText(sub, MAX_SUB_BYTES) &&
    isCircuitText(email, MAX_EMAIL_BYTES) &&
    isUint(exp, Number.MAX_SAFE_INTEGER) &&
    typeof nonce === 'string' &&
    nonce !== ''
    ? { aud, sub, email, exp, nonce }
    : null
}

/** Parse the fixed RS256 token layout; any failure is an authorization error. */
export function parseGoogleIdToken(idToken: string): ParsedGoogleIdToken {
  const segments = idToken.split('.')
  const [headerB64, payloadB64] = segments
  const [header, payload, signature] =
    segments.length === 3 && !segments.includes('') ? segments.map(b64urlDecode) : []
  const claims = payload && googleClaims(json(payload))
  if (!header || !payload || !signature || !claims)
    throw new CeremonyError('authorization', 'invalid Google ID token')
  const fields = json(header)
  if (fields?.alg !== 'RS256' || typeof fields.kid !== 'string' || fields.kid === '')
    throw new CeremonyError('authorization', 'invalid Google ID token header')
  return { kid: fields.kid, headerB64, payload, payloadB64, signature, claims }
}

/** Accept a token only for this ceremony's client and before its signed expiry. */
export function acceptGoogleIdToken(idToken: string, clientId: string): ParsedGoogleIdToken {
  const token = parseGoogleIdToken(idToken)
  if (token.claims.aud !== clientId || token.claims.exp <= Date.now() / 1000)
    throw new CeremonyError('authorization', 'Invalid Google token')
  return token
}

/** Select the one published signing key carrying the token's `kid`. */
export async function fetchSigningKey(kid: string, signal: AbortSignal): Promise<unknown> {
  // A run closed before this point starts no key request.
  signal.throwIfAborted()
  const response = await fetch(provider.jwksUrl, {
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new Error('Signing key request failed')
  const body = await readJson(response, MAX_JWKS_BYTES)
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
  const keys = body.keys.filter((k) => isRecord(k) && k.kid === kid)
  if (keys.length !== 1) throw new Error('Signing key is not unique')
  return keys[0]
}
