import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { identityNodes } from '../../../identity.js'
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

const invalid = (what: string) => new Error(`Telegram ID token: ${what}`)

/** An RS256 ID token split once, with the claims oidc_telegram reveals and the nonce's digest. */
export interface ParsedTelegramIdToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; iat: number; id: string; preferred_username: string; nonce: string }
  authorizationDigest: Uint8Array
}

/**
 * Build the libid-circuits `oidc_telegram` inputs for an accepted `token` signed under
 * `modulus`; only the circuit's own bounds are checked here.
 */
export function buildOidcTelegramInputs(token: ParsedTelegramIdToken, modulus: Uint8Array) {
  const { headerB64, payloadB64, payload, signature, authorizationDigest } = token
  const { aud, iat, id, preferred_username, nonce } = token.claims
  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`)
  if (signingInput.length > MAX_SIGNING_INPUT_BYTES) throw invalid('signing input is too long')
  const audience = encoder.encode(aud)
  if (audience.length === 0 || audience.length > MAX_AUD_BYTES) throw invalid('bad aud')
  if (String(iat).length > MAX_IAT_DIGITS) throw invalid('bad iat')
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
