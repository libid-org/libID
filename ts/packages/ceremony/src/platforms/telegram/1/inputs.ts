import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { buildOidcTelegramInputs } from '../../../barretenberg/circuits/oidc_telegram/inputs.js'
import { identityNodes } from '../../../identity.js'
import { rs256Modulus } from '../../oidc.js'
import type { Identity } from '../../validation.js'
import type { ParsedTelegramIdToken } from './token.js'

/** Adapt an accepted token and the JWK selected by its `kid` to the circuit ABI and delivery. */
export function prepareTelegramInputs(token: ParsedTelegramIdToken, jwk: unknown) {
  const modulus = rs256Modulus(jwk, token.signature)
  const { aud, iat, id, preferred_username } = token.claims
  const identity: Identity<'telegram'> = {
    platformId: PLATFORM_TELEGRAM_KEY,
    oauthClientId: aud,
    userId: id,
    userName: preferred_username,
  }
  return {
    inputs: buildOidcTelegramInputs(token, modulus, identityNodes(identity)),
    authorizationDigest: token.authorizationDigest,
    identity,
    proofFields: { tokenIssuedAt: iat, signingKeyModulus: modulus },
  }
}
