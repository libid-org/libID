import type { IdentityNodes } from '../../../identity.js'
import { bytesToBigInt, halves } from '../../parameters.js'
import { audienceHash, findOffset, hex, limbs, pad, redc } from '../oidc.js'
import {
  ISSUER,
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_PAYLOAD_JSON_BYTES,
  MAX_SIGNING_INPUT_BYTES,
  MAX_SUB_BYTES,
} from './parameters.js'

/** Token bytes and claim values consumed by the fixed oidc_google circuit. */
export interface OidcGoogleToken {
  headerB64: string
  payloadB64: string
  payload: Uint8Array
  signature: Uint8Array
  claims: { aud: string; sub: string; email: string; exp: number; nonce: string }
}

const encoder = new TextEncoder()

/**
 * Build the exact libid-circuits v0.8.0 `oidc_google` circuit inputs. `nodes` are the token's
 * id node and handle node, which the circuit recomputes from the signed `sub` and `email`.
 */
export function buildOidcGoogleInputs(
  token: OidcGoogleToken,
  modulus: Uint8Array,
  authorizationDigest: Uint8Array,
  nodes: IdentityNodes,
) {
  const signingInput = encoder.encode(`${token.headerB64}.${token.payloadB64}`)
  if (signingInput.length > MAX_SIGNING_INPUT_BYTES)
    throw new Error('Google signing input is too long')
  if (token.payload.length > MAX_PAYLOAD_JSON_BYTES)
    throw new Error('Google token payload is too long')

  const { aud, sub, email, exp, nonce } = token.claims
  const emailBytes = encoder.encode(email)
  const subBytes = encoder.encode(sub)
  const audienceBytes = encoder.encode(aud)
  const expString = String(exp)
  const offset = (claim: string) => String(findOffset(token.payload, claim))
  const modulusInteger = bytesToBigInt(modulus)

  return {
    signing_input: Array.from(pad(signingInput, MAX_SIGNING_INPUT_BYTES)),
    signing_input_len: String(signingInput.length),
    header_b64_len: String(token.headerB64.length),
    payload_json: Array.from(pad(token.payload, MAX_PAYLOAD_JSON_BYTES)),
    payload_json_len: String(token.payload.length),
    email_offset: offset(`"email":"${email}"`),
    nonce_offset: offset(`"nonce":"${nonce}"`),
    sub_offset: offset(`"sub":"${sub}"`),
    email_verified_offset: offset('"email_verified":true'),
    exp_offset: offset(`"exp":${expString}`),
    exp_len: String(expString.length),
    iss_offset: offset(`"iss":"${ISSUER}"`),
    aud_offset: offset(`"aud":"${aud}"`),
    email_bytes: Array.from(pad(emailBytes, MAX_EMAIL_BYTES)),
    email_len: String(emailBytes.length),
    sub_bytes: Array.from(pad(subBytes, MAX_SUB_BYTES)),
    sub_len: String(subBytes.length),
    audience_bytes: Array.from(pad(audienceBytes, MAX_AUD_BYTES)),
    audience_len: String(audienceBytes.length),
    signature: limbs(bytesToBigInt(token.signature)).map(hex),
    redc: redc(modulusInteger).map(hex),
    authorization_digest: Array.from(authorizationDigest),
    audience_hash: audienceHash(audienceBytes).map(hex),
    id_node: halves(nodes.idNode).map(hex),
    handle_node: halves(nodes.handleNode).map(hex),
    exp: expString,
    modulus: limbs(modulusInteger).map(hex),
  }
}
