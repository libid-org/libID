import { assetUrl } from '../../../assets/index.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { operation } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { prepareGoogleInputs } from './inputs.js'
import { acceptGoogleIdToken, fetchSigningKey } from './token.js'
import { isGooglePublicInputs } from './validation.js'

export async function prove(context: ProverContext<'google'>) {
  const { signal, emit } = context
  const token = acceptGoogleIdToken(context.credential, context.request.clientId)
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
      () => prepareGoogleInputs(token, key),
    )
    const raw = await engine.prove(inputs, signal)
    const proof = { identityProof: raw.proof, publicInputs: raw.publicInputs, ...proofFields }
    if (!isGooglePublicInputs(raw.publicInputs, authorizationDigest, identity, proof))
      throw new Error('Google public input mismatch')
    return { identity, proof }
  } finally {
    engine.destroy()
  }
}
