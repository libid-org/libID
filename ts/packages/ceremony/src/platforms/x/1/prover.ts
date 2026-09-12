import { resolve as resolveAsset } from '../../../assets/index.js'
import {
  buildBearerLinkWitness,
  validateBearerLinkPublicInputs,
} from '../../../barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError, ceremonyError } from '../../../errors.js'
import { now, operation } from '../../../events.js'
import { responseJson } from '../../../notary/http.js'
import { bearerOpening } from '../../../notary/notarize.js'
import { Notarization } from '../../../notary/session.js'
import { isRecord } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import {
  buildIdentityRequest,
  buildTokenRequest,
  identityFromReveals,
  selectIdentityReveals,
  selectTokenReveals,
} from './transcript.js'
import type { XProofV1 } from './types.js'
import { circuit, verificationKey } from './x.assets.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'x'>; proof: XProofV1 } | null> {
  const { request, emit } = context
  context.signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new CeremonyError('authorization', 'Invalid X return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'X authorization failed')
  const controller = new AbortController(),
    abort = () => controller.abort(context.signal.reason)
  context.signal.addEventListener('abort', abort, { once: true })
  const engine = new ProofEngine({
    circuitUrl: resolveAsset(circuit),
    verificationKeyUrl: resolveAsset(verificationKey),
    emit,
  })
  // Observe every provisional branch immediately; any failure retires sibling work.
  const observe = <T>(p: Promise<T>) => {
    void p.catch((error) => controller.abort(error))
    return p
  }
  try {
    const input = {
      clientId: request.clientId,
      code: returned.code,
      redirectUri: request.redirectUri,
      codeVerifier: request.codeVerifier,
    }
    const notary = new Notarization(request.notaryAddress!, controller.signal)
    const tokenRequest = buildTokenRequest(input)
    const tokenSession = observe(
      notary.prepare(tokenRequest.url).catch((e) => {
        throw ceremonyError(e, 'token-fetch')
      }),
    )
    const identitySession = observe(
      notary.prepare('https://api.x.com/2/users/me').catch((e) => {
        throw ceremonyError(e, 'identity-fetch')
      }),
    )
    const { session, selection, bearer } = await operation(emit, 'token-fetch', async () => {
      const session = await tokenSession
      const transcript = await session.send(tokenRequest)
      const body = responseJson(transcript)
      const selection = selectTokenReveals(
        { sent: transcript.sent, recv: transcript.received },
        input,
      )
      if (!isRecord(body) || body.access_token !== selection.accessToken)
        throw new Error('Invalid token response')
      const bearer = selection.accessToken
      return { session, selection, bearer }
    })
    emit({ event: 'token-attestation', phase: 'started', timestamp: now() })
    const tokenReveal = observe(
      session
        .reveal({ sent: selection.ranges.sent, received: selection.ranges.recv })
        .then((value) => {
          const attestation = observe(
            value.attestation
              .then((result) => {
                emit({ event: 'token-attestation', phase: 'finished', timestamp: now() })
                return result
              })
              .catch((e) => {
                throw ceremonyError(e, 'token-attestation')
              }),
          )
          return { ...value, attestation }
        })
        .catch((e) => {
          throw ceremonyError(e, 'token-attestation')
        }),
    )
    const { identity, ranges, extracted } = await operation(emit, 'identity-fetch', async () => {
      const identity = await identitySession
      const identityTranscript = await identity.send(buildIdentityRequest(bearer))
      const identityBody = responseJson(identityTranscript),
        ranges = selectIdentityReveals(
          { sent: identityTranscript.sent, recv: identityTranscript.received },
          bearer,
        )
      const extracted = identityFromReveals(
        ranges.recv.map((r) => identityTranscript.received.slice(r.start, r.end)),
      )
      if (
        !isRecord(identityBody) ||
        !isRecord(identityBody.data) ||
        identityBody.data.id !== extracted.userId ||
        identityBody.data.username !== extracted.handle
      )
        throw new Error('Invalid identity response')
      return { identity, ranges, extracted }
    })
    emit({ event: 'identity-attestation', phase: 'started', timestamp: now() })
    const identityReveal = observe(
      identity
        .reveal({ sent: ranges.sent, received: ranges.recv })
        .then((value) => {
          const attestation = observe(
            value.attestation
              .then((result) => {
                emit({ event: 'identity-attestation', phase: 'finished', timestamp: now() })
                return result
              })
              .catch((e) => {
                throw ceremonyError(e, 'identity-attestation')
              }),
          )
          return { ...value, attestation }
        })
        .catch((e) => {
          throw ceremonyError(e, 'identity-attestation')
        }),
    )
    const [first, second] = await Promise.all([tokenReveal, identityReveal])
    const final = observe(Promise.all([first.attestation, second.attestation]))
    const inputs = await operation(emit, 'circuit-inputs', () =>
      buildBearerLinkWitness(
        bearer,
        bearerOpening(first.openings, 'received', selection.bearerRange, bearer),
        bearerOpening(
          second.openings,
          'sent',
          { start: ranges.sent[0].end, end: ranges.sent[1].start },
          bearer,
        ),
      ),
    )
    const proof = observe(engine.prove(inputs, controller.signal))
    const [raw, [tokenAttestation, identityAttestation]] = await Promise.all([proof, final])
    if (!validateBearerLinkPublicInputs(raw.publicInputs, inputs))
      throw new Error('Bearer public input mismatch')
    return {
      identity: {
        platformId: 'x',
        oauthClientId: request.clientId,
        userId: extracted.userId,
        userName: extracted.handle,
      },
      proof: {
        bearerLinkProof: raw.proof,
        tokenAttestation,
        identityAttestation,
      },
    }
  } finally {
    context.signal.removeEventListener('abort', abort)
    controller.abort()
    engine.destroy()
  }
}
