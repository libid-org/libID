import { assetUrl } from '../../../assets/index.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { operation } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { acceptReturn } from '../../oauthReturn.js'
import { validateGooglePublicInputs } from './publicInputs.js'
import { acceptGoogleIdToken, fetchSigningKey } from './token.js'
import { buildGoogleWitness } from './witness.js'

export async function prove(context: ProverContext) {
  const { signal, emit } = context
  const idToken = acceptReturn(context, 'google')
  if (idToken === null) return null
  const token = acceptGoogleIdToken(idToken, context.request.clientId)
  const engine = new ProofEngine({
    circuitUrl: assetUrl(circuit),
    verificationKeyUrl: assetUrl(verificationKey),
    emit,
  })
  try {
    const key = await operation(emit, 'signing-key-fetch', () => fetchSigningKey(token.kid, signal))
    const { inputs, authorizationDigest, identity, proofFields } = await operation(
      emit,
      'circuit-inputs',
      () => buildGoogleWitness(token, key),
    )
    const raw = await engine.prove(inputs, signal),
      proof = { identityProof: raw.proof, publicInputs: raw.publicInputs, ...proofFields }
    if (!validateGooglePublicInputs(raw.publicInputs, authorizationDigest, identity, proof))
      throw new Error('Google public input mismatch')
    return { identity, proof }
  } finally {
    engine.destroy()
  }
}
