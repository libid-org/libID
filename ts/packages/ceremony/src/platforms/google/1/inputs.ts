import { PLATFORM_GOOGLE_KEY } from '@libid/contracts/platforms'
import { buildOidcGoogleInputs } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { AUTHORIZATION_DIGEST_BYTES } from '../../../ccdp/limits.js'
import { identityNodes } from '../../../identity.js'
import { b64urlDecode } from '../../../primitives.js'
import { rs256Modulus } from '../../oidc.js'
import type { Identity } from '../../validation.js'
import type { ParsedGoogleIdToken } from './token.js'

/** Adapt a parsed platform token and the JWK selected by its `kid` to the circuit ABI and delivery. */
export function prepareGoogleInputs(token: ParsedGoogleIdToken, jwk: unknown) {
  const modulus = rs256Modulus(jwk, token.signature)
  const authorizationDigest = b64urlDecode(token.claims.nonce)
  if (authorizationDigest?.length !== AUTHORIZATION_DIGEST_BYTES) {
    throw new Error('Google nonce must encode a 32-byte authorization digest')
  }

  const { aud, sub, email, exp } = token.claims
  const identity: Identity<'google'> = {
    platformId: PLATFORM_GOOGLE_KEY,
    oauthClientId: aud,
    userId: sub,
    userName: email,
  }
  return {
    inputs: buildOidcGoogleInputs(token, modulus, authorizationDigest, identityNodes(identity)),
    authorizationDigest,
    identity,
    proofFields: { tokenExpiresAt: exp, signingKeyModulus: modulus },
  }
}
