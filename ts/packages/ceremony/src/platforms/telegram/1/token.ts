import { CeremonyError } from '../../../errors.js'
import { b64urlDecode, b64urlEncode, isUint } from '../../../primitives.js'
import { fetchSigningKey as fetchKey, jsonObject as json } from '../../oidc.js'
import { provider } from './provider.js'

/** The accepted token's signing key ID and the identity it carries. */
export interface TelegramIdToken {
  kid: string
  claims: { id: string; preferred_username: string }
}

const MAX_FUTURE_IAT_SECONDS = 300
const MAX_AGE_SECONDS = 3600

const invalid = (message = 'Invalid Telegram ID token') =>
  new CeremonyError('authorization', message)

/** Accept an RS256 token for this client, this ceremony's nonce, and a fresh `iat`. */
export function acceptTelegramIdToken(
  idToken: string,
  clientId: string,
  authorizationDigest: Uint8Array,
): TelegramIdToken {
  const segments = idToken.split('.')
  if (segments.length !== 3 || segments.includes('') || !b64urlDecode(segments[2])) throw invalid()
  const [header, p] = segments.slice(0, 2).map((s) => json(b64urlDecode(s)))
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '' || !p)
    throw invalid()
  const now = Date.now() / 1000
  if (
    p.iss !== provider.issuer ||
    typeof p.aud !== 'string' ||
    p.aud !== clientId ||
    p.nonce !== b64urlEncode(authorizationDigest) ||
    !isUint(p.iat, Number.MAX_SAFE_INTEGER) ||
    p.iat > now + MAX_FUTURE_IAT_SECONDS ||
    now > p.iat + MAX_AGE_SECONDS ||
    typeof p.id !== 'string' ||
    !/^[0-9]+$/.test(p.id)
  )
    throw invalid()
  // TODO: check id and handle with isAccountId/isHandle once @libid/contracts has Telegram.
  if (typeof p.preferred_username !== 'string' || p.preferred_username === '')
    throw invalid('Set a Telegram username, then try again')
  return { kid: header.kid, claims: { id: p.id, preferred_username: p.preferred_username } }
}

/** Select the one key carrying `kid` from Telegram's key set, served beside the Bridge callback. */
export const fetchSigningKey = (redirectUri: string, kid: string, signal: AbortSignal) =>
  fetchKey(new URL(provider.jwksPath, redirectUri).href, kid, signal)
