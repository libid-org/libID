import { resolve as resolveAsset } from '../../../assets.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError, ceremonyError } from '../../../errors.js'
import { isRecord } from '../../../primitives.js'
import { buildBearerLinkWitness } from '../../../prover/bearerLink.js'
import type { ProverContext } from '../../../prover/context.js'
import { PROOF_ENGINE_SPANS, ProofEngine } from '../../../prover/engine.js'
import { bearerOpening, responseJson } from '../../../prover/http.js'
import { Notarization } from '../../../prover/notarization/session.js'
import { Progress } from '../../../prover/progress.js'
import { readBody } from '../../../response.js'
import { isFormClientId } from '../../authorization.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { Identity } from '../../types.js'
import { circuit, verificationKey } from './assets.js'
import { admitTokenResponse, decodeTokenResponse, encodeTokenRequest } from './token.js'
import { identityRequest, selectIdentity } from './transcript.js'
import type { GitHubProofV1 } from './types.js'

const spans = [
  { code: 'token-exchange', label: 'Exchanging authorization code', weight: 20 },
  { code: 'identity-session', label: 'Fetching identity', weight: 20 },
  { code: 'attestation', label: 'Completing identity evidence', weight: 5 },
  ...PROOF_ENGINE_SPANS,
]
export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'github'>; proof: GitHubProofV1 } | null> {
  const { request, onProgress, signal } = context
  const { codeVerifier } = request
  signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn, 'https://github.com/login/oauth')
  if (!returned || returned.state !== oauthState(context.ceremonyId) || codeVerifier === null)
    throw new CeremonyError('oauth-return', { cause: new Error('Invalid GitHub return') })
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('oauth-return', { cause: new Error('GitHub authorization failed') })
  context.onStage('code-exchange')
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
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
    const notary = new Notarization(request.notaryAddress!, controller.signal)
    const identitySession = notary.prepare('https://api.github.com/user')
    // Setup needs no bearer; a failure must stop the concurrent Bridge request.
    void identitySession.catch((error) => controller.abort(error))
    const { token, admitted } = await progress
      .step('token-exchange', async () => {
        const response = await fetch(
          new URL('/api/v1/ceremony/github-token', request.redirectUri),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: encodeTokenRequest({
              code: returned.code,
              codeVerifier,
              notaryAddress: request.notaryAddress!,
            }).slice().buffer,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            mode: 'cors',
            signal: notary.signal,
          },
        )
        if (
          response.status !== 200 ||
          response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
        )
          throw new Error('Token exchange failed')
        const token = decodeTokenResponse(await readBody(response, 3 * 1024 * 1024))
        const admitted = admitTokenResponse(token, {
          clientId: request.clientId,
          code: returned.code,
          redirectUri: request.redirectUri,
          codeVerifier,
        })
        return { token, admitted }
      })
      .catch((error) => {
        notary.signal.throwIfAborted()
        throw ceremonyError(error, 'token-exchange')
      })
    context.onStage('identity-fetch')
    const session = await identitySession
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
    context.onStage('proof-preparation')
    const inputs = buildBearerLinkWitness(
      token.accessToken,
      admitted.bearer,
      bearerOpening(result.openings, 'sent', selected.bearerRange, token.accessToken),
    )
    const [raw, identityAttestation] = await Promise.all([
      engine.prove(inputs, notary.signal),
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
      proof: {
        bearerLinkProof: raw.proof,
        tokenAttestation: { ...token.tokenAttestation, decoded: admitted.decoded },
        identityAttestation,
      },
    }
  } finally {
    signal.removeEventListener('abort', abort)
    controller.abort()
    engine.destroy()
    progress.failActive()
  }
}
