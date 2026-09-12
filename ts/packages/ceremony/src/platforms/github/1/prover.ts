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
import { readBody } from '../../../response.js'
import { isFormClientId } from '../../authorization.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import { circuit, verificationKey } from './github.assets.js'
import { admitTokenResponse, decodeTokenResponse, encodeTokenRequest } from './token.js'
import { identityRequest, selectIdentity } from './transcript.js'
import type { GitHubProofV1 } from './types.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'github'>; proof: GitHubProofV1 } | null> {
  const { request, emit, signal } = context
  const { codeVerifier } = request
  signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn, 'https://github.com/login/oauth')
  if (!returned || returned.state !== oauthState(context.ceremonyId) || codeVerifier === null)
    throw new CeremonyError('authorization', 'Invalid GitHub return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'GitHub authorization failed')
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const engine = new ProofEngine({
    circuitUrl: resolveAsset(circuit),
    verificationKeyUrl: resolveAsset(verificationKey),
    emit,
  })
  try {
    const notary = new Notarization(request.notaryAddress!, controller.signal)
    const identitySession = notary.prepare('https://api.github.com/user').catch((e) => {
      throw ceremonyError(e, 'identity-fetch')
    })
    // Setup needs no bearer; a failure must stop the concurrent Bridge request.
    void identitySession.catch((error) => controller.abort(error))
    const { token, admitted } = await operation(emit, 'token-attestation', async () => {
      const response = await fetch(new URL('/api/v1/ceremony/github-token', request.redirectUri), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: encodeTokenRequest({
          code: returned.code,
          codeVerifier,
          redirectUri: request.redirectUri,
          notaryAddress: request.notaryAddress!,
        }).slice().buffer,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'cors',
        signal: notary.signal,
      })
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
    }).catch((error) => {
      notary.signal.throwIfAborted()
      throw ceremonyError(error, 'token-attestation')
    })
    const selectedIdentity = await operation(emit, 'identity-fetch', async () => {
      const session = await identitySession
      const transcript = await session.send(identityRequest(token.accessToken))
      const body = responseJson(transcript, true),
        selected = selectIdentity(transcript, token.accessToken)
      if (
        !isRecord(body) ||
        typeof body.id !== 'bigint' ||
        body.id.toString() !== selected.userId ||
        body.login !== selected.userName
      )
        throw new Error('Invalid GitHub identity')
      return { session, selected }
    })
    const { session, selected } = selectedIdentity
    emit({ event: 'identity-attestation', phase: 'started', timestamp: now() })
    const result = await session.reveal(selected.ranges).catch((e) => {
      throw ceremonyError(e, 'identity-attestation')
    })
    const attestation = result.attestation
      .then((value) => {
        emit({ event: 'identity-attestation', phase: 'finished', timestamp: now() })
        return value
      })
      .catch((e) => {
        throw ceremonyError(e, 'identity-attestation')
      })
    void attestation.catch((error) => controller.abort(error))
    const inputs = await operation(emit, 'circuit-inputs', () =>
      buildBearerLinkWitness(
        token.accessToken,
        admitted.bearer,
        bearerOpening(result.openings, 'sent', selected.bearerRange, token.accessToken),
      ),
    )
    const [raw, identityAttestation] = await Promise.all([
      engine.prove(inputs, notary.signal),
      attestation,
    ])
    if (!validateBearerLinkPublicInputs(raw.publicInputs, inputs))
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
  }
}
