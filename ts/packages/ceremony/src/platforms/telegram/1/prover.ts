import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { assetUrl } from '../../../assets/index.js'
import { buildOidcTelegramInputs } from '../../../barretenberg/circuits/oidc_telegram/inputs.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_telegram/oidc_telegram.assets.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { operation } from '../../../events.js'
import { b64urlDecode } from '../../../primitives.js'
import type { ProverContext } from '../../context.js'
import { rs256Modulus } from '../../oidc.js'
import type { Identity } from '../../validation.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { isTelegramPublicInputs } from './validation.js'

export async function prove(context: ProverContext<'telegram'>) {
  const { signal, emit, request, codeVerifier } = context
  const { redirectUri } = request
  const idToken = await operation(emit, 'token-fetch', () =>
    swapCode({ code: context.credential, codeVerifier, redirectUri }, signal),
  )
  const token = acceptTelegramIdToken(idToken, request.clientId)
  const { aud, iat, id, preferred_username } = token.claims
  const identity: Identity<'telegram'> = {
    platformId: PLATFORM_TELEGRAM_KEY,
    oauthClientId: aud,
    userId: id,
    userName: preferred_username,
  }
  const engine = new ProofEngine({
    circuitUrl: assetUrl(circuit),
    verificationKeyUrl: assetUrl(verificationKey),
    emit,
  })
  try {
    const key = await operation(emit, 'signing-key-fetch', () =>
      fetchSigningKey(redirectUri, token.kid, signal),
    )
    const { inputs, modulus } = await operation(emit, 'circuit-inputs', () => {
      const modulus = rs256Modulus(key, b64urlDecode(idToken.split('.')[2]))
      return {
        inputs: buildOidcTelegramInputs(idToken, modulus, token.authorizationDigest),
        modulus,
      }
    })
    const raw = await engine.prove(inputs, signal)
    const proof = {
      identityProof: raw.proof,
      publicInputs: raw.publicInputs,
      tokenIssuedAt: iat,
      signingKeyModulus: modulus,
    }
    if (!isTelegramPublicInputs(raw.publicInputs, token.authorizationDigest, identity, proof))
      throw new Error('Telegram public input mismatch')
    return { identity, proof }
  } finally {
    engine.destroy()
  }
}
