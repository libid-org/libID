import { parseJson } from '../../../json.js'
import { b64urlDecode } from '../../../primitives.js'
import { MAX_AUD_BYTES, MAX_EMAIL_BYTES, MAX_SUB_BYTES, printableWithoutQuote } from './types.js'

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
    const value: unknown = parseJson(text.decode(bytes))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** The one strict payload decoder used only by Prover. */
export function decodeGoogleIdToken(idToken: string): DecodedGoogleIdToken | null {
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
  if (typeof aud !== 'string' || aud.length > MAX_AUD_BYTES || !printableWithoutQuote.test(aud)) {
    return null
  }
  if (typeof sub !== 'string' || sub.length > MAX_SUB_BYTES || !printableWithoutQuote.test(sub)) {
    return null
  }
  if (
    typeof email !== 'string' ||
    email.length > MAX_EMAIL_BYTES ||
    !printableWithoutQuote.test(email)
  ) {
    return null
  }
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

export function decodeGoogleHeader(bytes: Uint8Array): Record<string, unknown> | null {
  return json(bytes)
}

interface ParsedGoogleIdToken extends DecodedGoogleIdToken {
  kid: string
}

export function parseGoogleIdToken(idToken: string): ParsedGoogleIdToken {
  const token = decodeGoogleIdToken(idToken)
  if (token?.claims.iss !== 'https://accounts.google.com') {
    throw new Error('invalid Google ID token')
  }
  const header = decodeGoogleHeader(token.header)
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') {
    throw new Error('invalid Google ID token header')
  }
  return { ...token, kid: header.kid }
}
