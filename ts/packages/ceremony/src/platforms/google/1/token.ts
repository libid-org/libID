import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { b64urlDecode, isRecord } from '../../../primitives.js'
import { printableWithoutQuote } from './types.js'

export interface GoogleIdTokenClaims {
  iss: string
  aud: string
  sub: string
  email: string
  emailVerified: boolean
  exp: number
  nonce: string
}

export interface DecodedGoogleIdToken {
  header: Uint8Array
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

/** Circuit-bound claims are printable ASCII without quotes, so length is the byte length. */
const circuitText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && printableWithoutQuote.test(value)

function decodeGoogleIdToken(idToken: string): DecodedGoogleIdToken | null {
  const segments = idToken.split('.')
  if (segments.length !== 3 || segments.some((segment) => segment === '')) return null
  const [headerB64, payloadB64, signatureB64] = segments
  const header = b64urlDecode(headerB64)
  const payload = b64urlDecode(payloadB64)
  const signature = b64urlDecode(signatureB64)
  if (!header || !payload || !signature) return null

  const p = json(payload)
  if (!p) return null
  const { iss, aud, sub, email, email_verified: emailVerified, exp, nonce } = p
  if (typeof iss !== 'string' || iss === '') return null
  if (
    !circuitText(aud, MAX_AUD_BYTES) ||
    !circuitText(sub, MAX_SUB_BYTES) ||
    !circuitText(email, MAX_EMAIL_BYTES)
  )
    return null
  if (typeof emailVerified !== 'boolean') return null
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp < 0) return null
  if (typeof nonce !== 'string' || nonce === '') return null

  return {
    header,
    headerB64,
    payload,
    payloadB64,
    signature,
    claims: { iss, aud, sub, email, emailVerified, exp, nonce },
  }
}

export interface ParsedGoogleIdToken extends DecodedGoogleIdToken {
  kid: string
}

export function parseGoogleIdToken(idToken: string): ParsedGoogleIdToken {
  const token = decodeGoogleIdToken(idToken)
  if (token?.claims.iss !== 'https://accounts.google.com') {
    throw new Error('invalid Google ID token')
  }
  const header = json(token.header)
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
    throw new Error('invalid Google ID token header')
  }
  return { ...token, kid: header.kid }
}
