import { assetUrl } from '../../assets/index.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../../barretenberg/circuits/bearer_link/bearer_link.assets.js'
import {
  buildBearerLinkWitness,
  validateBearerLinkPublicInputs,
} from '../../barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../../barretenberg/engine.js'
import { CeremonyError, ceremonyError } from '../../errors.js'
import { operation } from '../../events.js'
import { responseJson } from '../../notary/http.js'
import { bearerOpening } from '../../notary/notarize.js'
import type { Reveals } from '../../notary/protocol.js'
import { Notarization, type NotarizationSession } from '../../notary/session.js'
import { isRecord } from '../../primitives.js'
import type { ProverContext } from '../context.js'
import type { Identity } from '../types.js'
import type { BearerTranscript } from './transcript.js'
import type { BearerLinkProofV1 } from './types.js'

/** Shared two-attestation bearer-link pipeline; platform transcripts own HTTP and identity policy. */
export async function proveBearerLink<P extends 'x' | 'github'>(
  context: ProverContext,
  platformId: P,
  profile: BearerTranscript,
  code: string,
): Promise<{ identity: Identity<P>; proof: BearerLinkProofV1 }> {
  const { emit, request } = context
  const { clientId, redirectUri, clientCredential, notaryAddress } = request
  if (notaryAddress === null) throw new CeremonyError('prover', 'Missing notary address')
  // acceptReturn admitted the verifier and credential this platform's catalog entry declares.
  const input = {
    clientId,
    code,
    redirectUri,
    codeVerifier: request.codeVerifier!,
    clientCredential,
  }
  const tokenRequest = profile.buildTokenRequest(input)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const engine = new ProofEngine({
    circuitUrl: assetUrl(bearerCircuit),
    verificationKeyUrl: assetUrl(bearerVerificationKey),
    emit,
  })
  // Observe every provisional branch immediately; any failure retires sibling work.
  const observe = <T>(p: Promise<T>) => {
    void p.catch((error) => controller.abort(error))
    return p
  }
  // Keep openings available immediately; observe final attestation failure before its join.
  async function reveal(
    session: NotarizationSession,
    ranges: Reveals,
    event: 'token-attestation' | 'identity-attestation',
  ) {
    try {
      const result = await session.reveal(ranges)
      const attestation = observe(
        result.attestation.catch((error) => {
          throw ceremonyError(error, event)
        }),
      )
      return { ...result, attestation }
    } catch (error) {
      throw ceremonyError(error, event)
    }
  }
  try {
    const notary = new Notarization(notaryAddress, signal, emit)
    const tokenPrepared = observe(
      notary.prepare(tokenRequest.url, 'token-attestation').catch((e) => {
        throw ceremonyError(e, 'token-fetch')
      }),
    )
    const identityPrepared = observe(
      notary.prepare(profile.identityUrl, 'identity-attestation').catch((e) => {
        throw ceremonyError(e, 'identity-fetch')
      }),
    )
    const token = await operation(emit, 'token-fetch', async () => {
      const session = await tokenPrepared
      const transcript = await session.send(tokenRequest)
      const body = responseJson(transcript)
      const selected = profile.selectToken(transcript, input)
      if (!isRecord(body) || body.access_token !== selected.accessToken)
        throw new Error('Invalid token response')
      return { session, selected }
    })
    const bearer = token.selected.accessToken
    const tokenOpened = observe(reveal(token.session, token.selected.ranges, 'token-attestation'))
    const identity = await operation(emit, 'identity-fetch', async () => {
      const session = await identityPrepared
      const transcript = await session.send(profile.buildIdentityRequest(bearer))
      const body = responseJson(transcript)
      const selected = profile.selectIdentity(transcript, bearer)
      if (!isRecord(body) || !profile.identityResponse(body, selected))
        throw new Error('Invalid identity response')
      return { session, selected }
    })
    const identityOpened = observe(
      reveal(identity.session, identity.selected.ranges, 'identity-attestation'),
    )
    const [tokenRevealed, identityRevealed] = await Promise.all([tokenOpened, identityOpened])
    const final = observe(Promise.all([tokenRevealed.attestation, identityRevealed.attestation]))
    const inputs = await operation(emit, 'circuit-inputs', () =>
      buildBearerLinkWitness(
        bearer,
        bearerOpening(tokenRevealed.openings, 'received', token.selected.bearerRange, bearer),
        bearerOpening(identityRevealed.openings, 'sent', identity.selected.bearerRange, bearer),
      ),
    )
    const proof = observe(engine.prove(inputs, signal))
    const [raw, [tokenAttestation, identityAttestation]] = await Promise.all([proof, final])
    if (!validateBearerLinkPublicInputs(raw.publicInputs, inputs))
      throw new Error('Bearer public input mismatch')
    const { userId, userName } = identity.selected
    return {
      identity: { platformId, oauthClientId: clientId, userId, userName },
      proof: { bearerLinkProof: raw.proof, tokenAttestation, identityAttestation },
    }
  } finally {
    controller.abort()
    engine.destroy()
  }
}
