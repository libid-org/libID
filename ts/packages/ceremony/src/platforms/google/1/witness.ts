import {
  buildGoogleInputs,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { b64urlDecode, isRecord } from '../../../primitives.js'
import type { ParsedGoogleIdToken } from './token.js'

/** Adapt a parsed platform token and the JWK selected by its `kid` to the circuit ABI and delivery. */
export function buildGoogleWitness(token: ParsedGoogleIdToken, jwk: unknown) {
  if (!isRecord(jwk) || jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || typeof jwk.n !== 'string') {
    throw new Error('JWK is not a Google RS256 signing key')
  }

  const modulus = b64urlDecode(jwk.n)
  if (!modulus || modulus.length !== RSA_MODULUS_BYTES || (modulus[0] & 0x80) === 0) {
    throw new Error('Google signing key must be RSA-2048')
  }
  if (token.signature.length !== RSA_MODULUS_BYTES) {
    throw new Error('Google ID token signature must be 256 bytes')
  }
  const authorizationDigest = b64urlDecode(token.claims.nonce)
  if (authorizationDigest?.length !== 32) {
    throw new Error('Google nonce must encode a 32-byte authorization digest')
  }

  const { aud, sub, email, exp } = token.claims
  return {
    inputs: buildGoogleInputs(token, modulus, authorizationDigest),
    authorizationDigest,
    identity: { platformId: 'google' as const, oauthClientId: aud, userId: sub, userName: email },
    proofFields: { tokenExpiresAt: exp, signingKeyModulus: modulus },
  }
}
