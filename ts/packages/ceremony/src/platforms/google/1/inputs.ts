import { PLATFORM_GOOGLE_KEY } from '@libid/contracts/platforms'
import { buildOidcGoogleInputs } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import {
  RSA_EXPONENT_BASE64URL,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { handleNode, idNode } from '../../../identity.js'
import { b64urlDecode, isRecord } from '../../../primitives.js'
import type { Identity } from '../../validation.js'
import type { ParsedGoogleIdToken } from './token.js'
import { userIdOf } from './validation.js'

/** Adapt a parsed platform token and the JWK selected by its `kid` to the circuit ABI and delivery. */
export function prepareGoogleInputs(token: ParsedGoogleIdToken, jwk: unknown) {
  if (
    !isRecord(jwk) ||
    jwk.kty !== 'RSA' ||
    jwk.e !== RSA_EXPONENT_BASE64URL ||
    typeof jwk.n !== 'string'
  ) {
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
  if (authorizationDigest?.length !== AUTHORIZATION_DIGEST_BYTES) {
    throw new Error('Google nonce must encode a 32-byte authorization digest')
  }

  const { aud, sub, email, exp } = token.claims
  const nodes = {
    idNode: idNode(PLATFORM_GOOGLE_KEY, sub),
    handleNode: handleNode(PLATFORM_GOOGLE_KEY, email),
  }
  const identity: Identity<'google'> = {
    platformId: PLATFORM_GOOGLE_KEY,
    oauthClientId: aud,
    userId: userIdOf(nodes.idNode),
    userName: email,
  }
  return {
    inputs: buildOidcGoogleInputs(token, modulus, authorizationDigest, nodes),
    authorizationDigest,
    identity,
    proofFields: { tokenExpiresAt: exp, signingKeyModulus: modulus },
  }
}
