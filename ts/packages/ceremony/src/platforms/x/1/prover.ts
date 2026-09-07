import { isFormClientId } from '../../authorization.js'
import { assetUrl } from '../../../assets.js'
import { oauthState } from '../../../ccdp/navigation.js'
import type { ProverContext } from '../../../prover/context.js'
import { ProofEngine, PROOF_ENGINE_SPANS } from '../../../prover/engine.js'
import { Progress } from '../../../prover/progress.js'
import { prepareNotarization } from '../../../prover/notarization/session.js'
import { buildBearerLinkWitness } from '../../../prover/bearerLink.js'
import { responseJson, bearerOpening } from '../../../prover/http.js'
import { isRecord } from '../../../primitives.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import {
  buildTokenRequest,
  buildIdentityRequest,
  selectTokenReveals,
  selectIdentityReveals,
  identityFromReveals,
} from './transcript.js'
import { circuit } from './assets.js'
import type { XProofV1 } from './types.js'
const spans = [
  { code: 'token-session', label: 'Exchanging authorization code', weight: 20 },
  { code: 'identity-session', label: 'Fetching identity', weight: 20 },
  { code: 'attestations', label: 'Completing identity evidence', weight: 5 },
  ...PROOF_ENGINE_SPANS,
]
export async function prove(context: ProverContext): Promise<XProofV1 | null> {
  const { request, onProgress } = context
  context.signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new Error('Invalid X return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted') throw new Error('X authorization failed')
  const controller = new AbortController(),
    abort = () => controller.abort(context.signal.reason)
  context.signal.addEventListener('abort', abort, { once: true })
  const progress = new Progress(spans, (step) =>
    onProgress(step, performance.timeOrigin + performance.now()),
  )
  const engine = new ProofEngine({
    circuitUrl: assetUrl(circuit),
    onProgress: (step) => {
      if (step.status === 'started') progress.start(step.code)
      else if (step.status === 'completed') progress.complete(step.code)
      else progress.fail(step.code)
    },
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
    const tokenRequest = buildTokenRequest(input)
    const tokenSession = observe(prepareNotarization(tokenRequest.url, controller.signal))
    const identitySession = observe(
      prepareNotarization('https://api.x.com/2/users/me', controller.signal),
    )
    const session = await tokenSession
    const transcript = await progress.step('token-session', () => session.send(tokenRequest))
    const body = responseJson(transcript)
    const selection = selectTokenReveals(
      { sent: transcript.sent, recv: transcript.received },
      input,
    )
    if (!isRecord(body) || body.access_token !== selection.accessToken)
      throw new Error('Invalid token response')
    const bearer = selection.accessToken
    const tokenReveal = observe(
      session
        .reveal({ sent: selection.ranges.sent, received: selection.ranges.recv })
        .then((value) => {
          observe(value.attestation)
          return value
        }),
    )
    const identity = await identitySession
    const identityTranscript = await progress.step('identity-session', () =>
      identity.send(buildIdentityRequest(bearer)),
    )
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
    const [first, second] = await Promise.all([
      tokenReveal,
      observe(identity.reveal({ sent: ranges.sent, received: ranges.recv })),
    ])
    const final = observe(Promise.all([first.attestation, second.attestation]))
    const inputs = buildBearerLinkWitness(
      bearer,
      bearerOpening(first.openings, 'received', selection.bearerRange, bearer),
      bearerOpening(
        second.openings,
        'sent',
        { start: ranges.sent[0].end, end: ranges.sent[1].start },
        bearer,
      ),
    )
    const proof = observe(engine.prove(inputs, controller.signal))
    const [raw, [tokenAttestation, identityAttestation]] = await Promise.all([
      proof,
      progress.step('attestations', () => final),
    ])
    const expected = [
      ...(inputs.token_commitment as number[]),
      ...(inputs.identity_commitment as number[]),
    ].map((n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`)
    if (raw.publicInputs.length !== 64 || raw.publicInputs.some((v, i) => v !== expected[i]))
      throw new Error('Bearer public input mismatch')
    return {
      identity: {
        platformId: 'x',
        oauthClientId: request.clientId,
        userId: extracted.userId,
        userName: extracted.handle,
      },
      bearerLinkProof: raw.proof,
      tokenAttestation,
      identityAttestation,
    }
  } finally {
    context.signal.removeEventListener('abort', abort)
    controller.abort()
    engine.destroy()
    progress.failActive()
  }
}
