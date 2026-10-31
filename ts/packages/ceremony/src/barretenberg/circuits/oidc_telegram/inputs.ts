import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { identityNodes } from '../../../identity.js'
import { b64urlDecode, b64urlEncode, isRecord, isUint } from '../../../primitives.js'
import { bytesToBigInt, halves } from '../../parameters.js'
import { audienceHash, findOffset, hex, limbs, pad, redc } from '../oidc.js'
import {
  ISSUER_CLAIM,
  MAX_AUD_BYTES,
  MAX_IAT_DIGITS,
  MAX_SIGNING_INPUT_BYTES,
  WINDOWS,
} from './parameters.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

const invalid = (what: string) => new Error(`Telegram ID token: ${what}`)

/** The payload's JSON object, or a refusal. */
function claimsOf(payload: Uint8Array): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(payload))
  } catch {
    throw invalid('payload is not JSON')
  }
  if (!isRecord(value)) throw invalid('payload is not an object')
  return value
}

/**
 * Build the libid-circuits `oidc_telegram` inputs for an RS256 `idToken` signed under
 * `modulus` whose nonce is base64url(`authorizationDigest`).
 */
export function buildOidcTelegramInputs(
  idToken: string,
  modulus: Uint8Array,
  authorizationDigest: Uint8Array,
) {
  const segments = idToken.split('.')
  if (segments.length !== 3) throw invalid('not three segments')
  const [headerB64, payloadB64, signatureB64] = segments
  const payload = b64urlDecode(payloadB64)
  const signature = b64urlDecode(signatureB64)
  if (!payload || !signature) throw invalid('malformed base64url')
  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`)
  if (signingInput.length > MAX_SIGNING_INPUT_BYTES) throw invalid('signing input is too long')

  const { aud, iat, id, preferred_username, nonce } = claimsOf(payload)
  if (typeof aud !== 'string' || /["\\]/.test(aud)) throw invalid('bad aud')
  const audience = encoder.encode(aud)
  if (audience.length === 0 || audience.length > MAX_AUD_BYTES) throw invalid('bad aud')
  if (!isUint(iat, Number.MAX_SAFE_INTEGER) || String(iat).length > MAX_IAT_DIGITS)
    throw invalid('bad iat')
  if (typeof id !== 'string' || typeof preferred_username !== 'string')
    throw invalid('no id or preferred_username')
  if (authorizationDigest.length !== AUTHORIZATION_DIGEST_BYTES)
    throw invalid('authorization digest is not 32 bytes')
  if (nonce !== b64urlEncode(authorizationDigest))
    throw invalid('nonce does not encode the authorization digest')
  // Throws for an id or username the circuit refuses.
  const nodes = identityNodes({
    platformId: PLATFORM_TELEGRAM_KEY,
    userId: id,
    userName: preferred_username,
  })

  /** The claim's offset and its window: whole payload groups from the one holding it. */
  const at = (claim: string, width: number) => {
    const offset = findOffset(payload, claim)
    const start = offset - (offset % 3)
    return [Array.from(pad(payload.subarray(start, start + width), width)), String(offset)] as const
  }
  const [issWindow, issOffset] = at(ISSUER_CLAIM, WINDOWS.iss)
  const [audWindow, audOffset] = at(`"aud":"${aud}"`, WINDOWS.aud)
  const [iatWindow, iatOffset] = at(`"iat":${iat}`, WINDOWS.iat)
  const [idWindow, idOffset] = at(`"id":"${id}"`, WINDOWS.id)
  const [usernameWindow, usernameOffset] = at(
    `"preferred_username":"${preferred_username}"`,
    WINDOWS.username,
  )
  const [nonceWindow, nonceOffset] = at(`"nonce":"${nonce}"`, WINDOWS.nonce)
  const modulusInteger = bytesToBigInt(modulus)

  return {
    signing_input: Array.from(pad(signingInput, MAX_SIGNING_INPUT_BYTES)),
    signing_input_len: String(signingInput.length),
    header_b64_len: String(headerB64.length),
    iss_window: issWindow,
    iss_offset: issOffset,
    aud_window: audWindow,
    aud_offset: audOffset,
    audience_len: String(audience.length),
    iat_window: iatWindow,
    iat_offset: iatOffset,
    iat_len: String(String(iat).length),
    id_window: idWindow,
    id_offset: idOffset,
    id_len: String(encoder.encode(id).length),
    username_window: usernameWindow,
    username_offset: usernameOffset,
    username_len: String(encoder.encode(preferred_username).length),
    nonce_window: nonceWindow,
    nonce_offset: nonceOffset,
    signature: limbs(bytesToBigInt(signature)).map(hex),
    redc: redc(modulusInteger).map(hex),
    authorization_digest: Array.from(authorizationDigest),
    audience_hash: audienceHash(audience).map(hex),
    id_node: halves(nodes.idNode).map(hex),
    handle_node: halves(nodes.handleNode).map(hex),
    iat: String(iat),
    modulus: limbs(modulusInteger).map(hex),
  }
}
