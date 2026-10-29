import { CeremonyError } from '../../../errors.js'
import { b64urlDecode, b64urlEncode, isRecord, isUint } from '../../../primitives.js'
import { fetchPublicJson } from '../../../response.js'
import { provider } from './provider.js'

/** The accepted token's signing key ID and the identity it carries. */
export interface TelegramIdToken {
  kid: string
  claims: { id: string; preferred_username: string }
}

const MAX_JWKS_BYTES = 128 * 1024
const MAX_FUTURE_IAT_SECONDS = 300
const MAX_AGE_SECONDS = 3600

const text = new TextDecoder('utf-8', { fatal: true })

function json(bytes: Uint8Array | null): Record<string, unknown> | null {
  try {
    const value: unknown = bytes && JSON.parse(text.decode(bytes))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

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
  if (typeof p.preferred_username !== 'string' || p.preferred_username === '')
    throw invalid('Set a Telegram username, then try again')
  return { kid: header.kid, claims: { id: p.id, preferred_username: p.preferred_username } }
}

/** Select the one key carrying `kid` from Telegram's key set, served by the Bridge. */
export async function fetchSigningKey(
  bridge: string,
  kid: string,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  const body = await fetchPublicJson(
    `${bridge}${provider.jwksPath}`,
    MAX_JWKS_BYTES,
    'Signing key request failed',
    signal,
    'default',
  )
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
  const keys = body.keys.filter((k) => isRecord(k) && k.kid === kid)
  if (keys.length !== 1) throw new Error('Signing key is not unique')
  return keys[0]
}
