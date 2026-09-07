import { isFormClientId } from '../../authorization.js'
import { readBody } from '../../../response.js'
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
import { encodeTokenRequest, decodeTokenResponse, admitTokenResponse } from './token.js'
import { identityRequest, selectIdentity } from './transcript.js'
import { circuit } from './assets.js'
import type { GitHubProofV1 } from './types.js'
const spans = [
  { code: 'token-exchange', label: 'Exchanging authorization code', weight: 20 },
  { code: 'identity-session', label: 'Fetching identity', weight: 20 },
  { code: 'attestation', label: 'Completing identity evidence', weight: 5 },
  ...PROOF_ENGINE_SPANS,
]
export async function prove(context: ProverContext): Promise<GitHubProofV1 | null> {
  const { request, onProgress, signal } = context
  signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new Error('Invalid GitHub return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted') throw new Error('GitHub authorization failed')
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
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
  try {
    const token = await progress.step('token-exchange', async () => {
      const response = await fetch(new URL('/api/v1/ceremony/github-token', request.redirectUri), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: encodeTokenRequest({
          code: returned.code,
          codeVerifier: request.codeVerifier,
          notaryAddress: context.notaryAddress,
        }).slice().buffer,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal,
      })
      if (
        response.status !== 200 ||
        response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
      )
        throw new Error('Token exchange failed')
      return decodeTokenResponse(await readBody(response, 3 * 1024 * 1024))
    })
    const admitted = admitTokenResponse(token, {
      clientId: request.clientId,
      code: returned.code,
      redirectUri: request.redirectUri,
      codeVerifier: request.codeVerifier,
    })
    const session = await prepareNotarization(
      'https://api.github.com/user',
      context.notaryAddress,
      controller.signal,
    )
    const transcript = await progress.step('identity-session', () =>
      session.send(identityRequest(token.accessToken)),
    )
    const body = responseJson(transcript, true),
      selected = selectIdentity(transcript, token.accessToken)
    if (
      !isRecord(body) ||
      typeof body.id !== 'bigint' ||
      body.id.toString() !== selected.userId ||
      body.login !== selected.userName
    )
      throw new Error('Invalid GitHub identity')
    const result = await session.reveal(selected.ranges)
    void result.attestation.catch((error) => controller.abort(error))
    const inputs = buildBearerLinkWitness(
      token.accessToken,
      admitted.bearer,
      bearerOpening(result.openings, 'sent', selected.bearerRange, token.accessToken),
    )
    const [raw, identityAttestation] = await Promise.all([
      engine.prove(inputs, controller.signal),
      progress.step('attestation', () => result.attestation),
    ])
    const expected = [
      ...(inputs.token_commitment as number[]),
      ...(inputs.identity_commitment as number[]),
    ].map((n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`)
    if (raw.publicInputs.length !== 64 || raw.publicInputs.some((v, i) => v !== expected[i]))
      throw new Error('Bearer public input mismatch')
    return {
      identity: {
        platformId: 'github',
        oauthClientId: request.clientId,
        userId: selected.userId,
        userName: selected.userName,
      },
      bearerLinkProof: raw.proof,
      tokenAttestation: { ...token.tokenAttestation, decoded: admitted.decoded },
      identityAttestation,
    }
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    engine.destroy()
    progress.failActive()
  }
}
