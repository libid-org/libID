import {
  MAX_FUTURE_ATTESTATION_SKEW_SECONDS_TELEGRAM,
  PROOF_LIFETIME_SECONDS_TELEGRAM,
} from '@libid/contracts/ceremony'
import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import type { OidcTelegramToken } from '../../../barretenberg/circuits/oidc_telegram/inputs.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { CeremonyError } from '../../../errors.js'
import { isAccountId, isHandle } from '../../../identity.js'
import { b64urlDecode, isUint } from '../../../primitives.js'
import { fetchSigningKey as fetchKey, parseRs256Jwt } from '../../oidc.js'
import { provider } from './provider.js'

/** The accepted token and its signing key ID. */
export interface ParsedTelegramIdToken extends OidcTelegramToken {
  kid: string
}

/** Shared rule: `iat ≤ now + skew` and `now < iat + lifetime`. */
function isFresh(iat: unknown): iat is number {
  const now = Date.now() / 1000
  return (
    isUint(iat, Number.MAX_SAFE_INTEGER) &&
    iat <= now + MAX_FUTURE_ATTESTATION_SKEW_SECONDS_TELEGRAM &&
    now < iat + PROOF_LIFETIME_SECONDS_TELEGRAM
  )
}

const invalid = (message = 'Invalid Telegram ID token') =>
  new CeremonyError('authorization', message)

/** Accept an RS256 token for this client with a fresh `iat` and a 32-byte digest as its nonce. */
export function acceptTelegramIdToken(idToken: string, clientId: string): ParsedTelegramIdToken {
  const jwt = parseRs256Jwt(idToken)
  if (!jwt?.kid) throw invalid()
  const { kid, headerB64, payloadB64, payload, signature, claims: p } = jwt
  const nonce = typeof p.nonce === 'string' ? p.nonce : ''
  const digest = b64urlDecode(nonce)
  if (
    p.iss !== provider.issuer ||
    p.aud !== clientId ||
    digest?.length !== AUTHORIZATION_DIGEST_BYTES ||
    !isFresh(p.iat) ||
    typeof p.id !== 'string' ||
    !isAccountId(PLATFORM_TELEGRAM_KEY, p.id)
  )
    throw invalid()
  const { iat, id, preferred_username } = p
  if (typeof preferred_username !== 'string' || preferred_username === '')
    throw invalid('Set a Telegram username, then try again')
  if (!isHandle(PLATFORM_TELEGRAM_KEY, preferred_username)) throw invalid()
  return {
    kid,
    headerB64,
    payloadB64,
    payload,
    signature,
    claims: { aud: clientId, iat, id, preferred_username, nonce },
    authorizationDigest: digest,
  }
}

/** Select the one key carrying `kid` from Telegram's key set, served uncached beside the Bridge callback. */
export const fetchSigningKey = (redirectUri: string, kid: string, signal: AbortSignal) =>
  fetchKey(new URL(provider.jwksPath, redirectUri).href, kid, signal, 'no-store')
