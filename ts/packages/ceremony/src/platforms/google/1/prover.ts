import { assetUrl } from '../../../assets/index.js'
import {
  circuit,
  verificationKey,
} from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { operation } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { acceptReturn } from '../../oauthReturn.js'
import type { Identity } from '../../types.js'
import { validateGooglePublicInputs } from './publicInputs.js'
import { acceptGoogleIdToken, fetchSigningKey } from './token.js'
import type { GoogleProofV1 } from './types.js'
import { buildGoogleWitness } from './witness.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'google'>; proof: GoogleProofV1 } | null> {
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
    const built = await operation(emit, 'circuit-inputs', () => buildGoogleWitness(token, key))
    const raw = await engine.prove(built.inputs, signal),
      proof = { identityProof: raw.proof, ...built.proofFields }
    if (
      !validateGooglePublicInputs(
        raw.publicInputs,
        built.authorizationDigest,
        built.identity,
        proof,
      )
    )
      throw new Error('Google public input mismatch')
    return { identity: built.identity, proof }
  } finally {
    engine.destroy()
  }
}
