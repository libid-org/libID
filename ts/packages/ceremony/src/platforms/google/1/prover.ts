import { assetUrl } from '../../../assets/index.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError, ceremonyError } from '../../../errors.js'
import { operation } from '../../../events.js'
import { isRecord } from '../../../primitives.js'
import { readBody } from '../../../response.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import { circuit, verificationKey } from './google.assets.js'
import { parseOAuthReturn } from './oauth.js'
import { validateGooglePublicInputs } from './publicInputs.js'
import { parseGoogleIdToken } from './token.js'
import type { GoogleProofV1 } from './types.js'
import { buildGoogleWitness } from './witness.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'google'>; proof: GoogleProofV1 } | null> {
  const { request, signal, emit } = context
  signal.throwIfAborted()
  const returned = parseOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier !== null
  )
    throw new CeremonyError('authorization', 'Invalid Google return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'Google authorization failed')
  let token: ReturnType<typeof parseGoogleIdToken>
  try {
    token = parseGoogleIdToken(returned.idToken)
  } catch (error) {
    throw ceremonyError(error, 'authorization')
  }
  if (
    token.claims.aud !== request.clientId ||
    !token.claims.emailVerified ||
    token.claims.exp <= Date.now() / 1000
  )
    throw new CeremonyError('authorization', 'Invalid Google token')
  const engine = new ProofEngine({
    circuitUrl: assetUrl(circuit),
    verificationKeyUrl: assetUrl(verificationKey),
    emit,
  })
  try {
    const key = await operation(emit, 'signing-key-fetch', async () => {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
      if (!response.ok) throw new Error('Signing key request failed')
      const body: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, 128 * 1024)),
      )
      if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
      const keys = body.keys.filter((k) => isRecord(k) && k.kid === token.kid)
      if (keys.length !== 1) throw new Error('Signing key is not unique')
      return keys[0]
    })
    const built = await operation(emit, 'circuit-inputs', () => buildGoogleWitness(token, key))
    const raw = await engine.prove(built.inputs, signal),
      proof = { identityProof: raw.proof, ...built.proofFields }
    if (
      !validateGooglePublicInputs(
        raw.publicInputs,
        new Uint8Array(built.inputs.authorization_digest),
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
