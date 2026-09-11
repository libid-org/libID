import { resolve as resolveAsset } from '../../../assets.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError } from '../../../errors.js'
import { isRecord } from '../../../primitives.js'
import type { ProverContext } from '../../context.js'
import { PROOF_ENGINE_SPANS, ProofEngine } from '../../../proving/bb/engine.js'
import { parseJson } from '../../../json.js'
import { Progress } from '../../../progress.js'
import { readBody } from '../../../response.js'
import type { Identity } from '../../types.js'
import { circuit, verificationKey } from './assets.js'
import { buildGoogleWitness } from '../../../proving/bb/circuits/oidc_google/inputs.js'
import { parseOAuthReturn } from './oauth.js'
import { validateGooglePublicInputs } from '../../../proving/bb/circuits/oidc_google/publicInputs.js'
import { decodeGoogleHeader, decodeGoogleIdToken } from './token.js'
import type { GoogleProofV1 } from './types.js'

const spans = [
  { code: 'signing-key-fetch', label: 'Fetching signing key', weight: 3 },
  { code: 'circuit-inputs', label: 'Preparing proof inputs', weight: 2 },
  ...PROOF_ENGINE_SPANS,
]
export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'google'>; proof: GoogleProofV1 } | null> {
  const { request, signal, onProgress } = context
  signal.throwIfAborted()
  const returned = parseOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier !== null
  )
    throw new CeremonyError('oauth-return', { cause: new Error('Invalid Google return') })
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('oauth-return', { cause: new Error('Google authorization failed') })
  const token = decodeGoogleIdToken(returned.idToken),
    header = token && decodeGoogleHeader(token.header)
  if (
    !token ||
    token.claims.aud !== request.clientId ||
    !token.claims.emailVerified ||
    token.claims.exp <= Date.now() / 1000 ||
    typeof header?.kid !== 'string'
  )
    throw new CeremonyError('oauth-return', { cause: new Error('Invalid Google token') })
  context.onStage('proof-preparation')
  const progress = new Progress(spans, (step) =>
    onProgress(step, performance.timeOrigin + performance.now()),
  )
  const engine = new ProofEngine({
    circuitUrl: resolveAsset(circuit),
    verificationKeyUrl: resolveAsset(verificationKey),
    onProgress: (step) => {
      if (step.status === 'started') progress.start(step.code)
      else if (step.status === 'completed') progress.complete(step.code)
      else progress.fail(step.code)
    },
  })
  try {
    const key = await progress.step('signing-key-fetch', async () => {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
      if (!response.ok) throw new Error('Signing key request failed')
      const body: unknown = parseJson(
        new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, 128 * 1024)),
      )
      if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
      const keys = body.keys.filter((k) => isRecord(k) && k.kid === header.kid)
      if (keys.length !== 1) throw new Error('Signing key is not unique')
      return keys[0]
    })
    const built = await progress.step('circuit-inputs', () =>
      buildGoogleWitness(returned.idToken, key),
    )
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
    progress.failActive()
  }
}
