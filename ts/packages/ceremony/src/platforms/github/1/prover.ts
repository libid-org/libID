import { resolve as resolveAsset } from '../../../assets/index.js'
import {
  buildBearerLinkWitness,
  validateBearerLinkPublicInputs,
} from '../../../barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../../../barretenberg/engine.js'
import { isClientCredential } from '../../../ccdp/index.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError, ceremonyError } from '../../../errors.js'
import { operation } from '../../../events.js'
import { responseJson } from '../../../notary/http.js'
import { bearerOpening } from '../../../notary/notarize.js'
import { Notarization, type NotarizationSession, type Reveals } from '../../../notary/session.js'
import { isRecord } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import { circuit, verificationKey } from './github.assets.js'
import { buildTokenRequest, selectToken } from './token.js'
import { identityRequest, selectIdentity } from './transcript.js'
import type { GitHubProofV1 } from './types.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'github'>; proof: GitHubProofV1 } | null> {
  const { request, emit } = context
  const { notaryAddress, clientCredential } = request
  context.signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn, 'https://github.com/login/oauth')
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new CeremonyError('authorization', 'Invalid GitHub return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'GitHub authorization failed')
  if (!isClientCredential(clientCredential))
    throw new CeremonyError('token-fetch', 'Missing GitHub public token-exchange credential')
  if (notaryAddress === null) throw new CeremonyError('prover', 'Missing notary address')
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
    const input = {
      clientId: request.clientId,
      code: returned.code,
      redirectUri: request.redirectUri,
      codeVerifier: request.codeVerifier,
      clientCredential,
    }
    const notary = new Notarization(notaryAddress, controller.signal, emit)
    const tokenRequest = buildTokenRequest(input)
    const tokenSession = observe(
      notary.prepare(tokenRequest.url, 'token-attestation').catch((e) => {
        throw ceremonyError(e, 'token-fetch')
      }),
    )
    const identitySession = observe(
      notary.prepare('https://api.github.com/user', 'identity-attestation').catch((e) => {
        throw ceremonyError(e, 'identity-fetch')
      }),
    )
    const { session, selection, bearer } = await operation(emit, 'token-fetch', async () => {
      const session = await tokenSession
      const transcript = await session.send(tokenRequest)
      const body = responseJson(transcript)
      const selection = selectToken(transcript, input)
      if (!isRecord(body) || body.access_token !== selection.accessToken)
        throw new Error('Invalid token response')
      const bearer = selection.accessToken
      return { session, selection, bearer }
    })
    const tokenReveal = observe(reveal(session, selection.ranges, 'token-attestation'))
    const { identity, selected } = await operation(emit, 'identity-fetch', async () => {
      const identity = await identitySession
      const transcript = await identity.send(identityRequest(bearer))
      const body = responseJson(transcript, true),
        selected = selectIdentity(transcript, bearer)
      if (
        !isRecord(body) ||
        typeof body.id !== 'bigint' ||
        body.id.toString() !== selected.userId ||
        body.login !== selected.userName
      )
        throw new Error('Invalid GitHub identity')
      return { identity, selected }
    })
    const identityReveal = observe(reveal(identity, selected.ranges, 'identity-attestation'))
    const [first, second] = await Promise.all([tokenReveal, identityReveal])
    const final = observe(Promise.all([first.attestation, second.attestation]))
    const inputs = await operation(emit, 'circuit-inputs', () =>
      buildBearerLinkWitness(
        bearer,
        bearerOpening(first.openings, 'received', selection.bearerRange, bearer),
        bearerOpening(second.openings, 'sent', selected.bearerRange, bearer),
      ),
    )
    const proof = observe(engine.prove(inputs, controller.signal))
    const [raw, [tokenAttestation, identityAttestation]] = await Promise.all([proof, final])
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
