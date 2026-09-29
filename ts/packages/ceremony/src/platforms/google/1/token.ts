import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { CeremonyError } from '../../../errors.js'
import { b64urlDecode, isRecord, uint } from '../../../primitives.js'
import { readJson } from '../../../response.js'
import { circuitText } from './types.js'

/** Claims the fixed oidc_google circuit consumes. */
export interface GoogleIdTokenClaims {
  aud: string
  sub: string
  email: string
  exp: number
  nonce: string
}

export interface ParsedGoogleIdToken {
  kid: string
  headerB64: string
  payload: Uint8Array
  payloadB64: string
  signature: Uint8Array
  claims: GoogleIdTokenClaims
}

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
function googleClaims(p: Record<string, unknown> | null): GoogleIdTokenClaims | null {
  if (p?.iss !== 'https://accounts.google.com' || p.email_verified !== true) return null
  const { aud, sub, email, exp, nonce } = p
  return circuitText(aud, MAX_AUD_BYTES) &&
    circuitText(sub, MAX_SUB_BYTES) &&
    circuitText(email, MAX_EMAIL_BYTES) &&
    uint(exp, Number.MAX_SAFE_INTEGER) &&
    typeof nonce === 'string' &&
    nonce !== ''
    ? { aud, sub, email, exp, nonce }
    : null
}

/** Parse the fixed RS256 token layout; any failure is an authorization error. */
export function parseGoogleIdToken(idToken: string): ParsedGoogleIdToken {
  const segments = idToken.split('.')
  const [headerB64, payloadB64, signatureB64] = segments
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
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new Error('Signing key request failed')
  const body = await readJson(response, 128 * 1024)
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
  const keys = body.keys.filter((k) => isRecord(k) && k.kid === kid)
  if (keys.length !== 1) throw new Error('Signing key is not unique')
  return keys[0]
}
