import { CeremonyError, toCeremonyError } from '../../../errors.js'
import { operation } from '../../../events.js'
import { responseJson } from '../../../notary/http.js'
import type { Reveals } from '../../../notary/protocol.js'
import { NotaryRuntime, type NotarySession } from '../../../notary/session.js'
import type { ProverContext } from '../../../platforms/context.js'
import type { Identity } from '../../../platforms/validation.js'
import { isRecord } from '../../../primitives.js'
import { BearerLinkCircuit } from './circuit.js'
import type { BearerExchange } from './exchange.js'
import type { BearerLinkProofV1 } from './validation.js'

/** Attribute a failure to the operation it interrupted. */
const failsAs = <T>(p: Promise<T>, event: string) =>
  p.catch((error): never => {
    throw toCeremonyError(error, event)
  })

/** Shared two-attestation bearer-link prover; platform transcripts own HTTP and identity policy. */
export async function proveBearerLink<P extends 'x' | 'github'>(
  context: ProverContext,
  platformId: P,
  exchange: BearerExchange,
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
  const tokenRequest = exchange.buildTokenRequest(input)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const circuit = new BearerLinkCircuit(emit)
  // Observe every provisional branch immediately; any failure retires sibling work.
  const observe = <T>(p: Promise<T>) => {
    void p.catch((error) => controller.abort(error))
    return p
  }
  // A provisional branch whose failure names its operation.
  const branch = <T>(p: Promise<T>, event: string) => observe(failsAs(p, event))
  // Keep openings available immediately; observe final attestation failure before its join.
  async function reveal(
    session: NotarySession,
    ranges: Reveals,
    event: 'token-attestation' | 'identity-attestation',
  ) {
    const result = await failsAs(session.reveal(ranges), event)
    return { ...result, attestation: branch(result.attestation, event) }
  }
  try {
    const notary = new NotaryRuntime(notaryAddress, signal, emit)
    const tokenPrepared = branch(
      notary.prepare(tokenRequest.url, { fetch: 'token-fetch', attestation: 'token-attestation' }),
      'token-fetch',
    )
    const identityPrepared = branch(
      notary.prepare(exchange.identityUrl, {
        fetch: 'identity-fetch',
        attestation: 'identity-attestation',
      }),
      'identity-fetch',
    )
    const token = await operation(emit, 'token-fetch', async () => {
      const session = await tokenPrepared
      const transcript = await session.send(tokenRequest)
      const body = responseJson(transcript)
      const selected = exchange.selectToken(transcript, input)
      if (!isRecord(body) || body.access_token !== selected.accessToken)
        throw new Error('Invalid token response')
      return { session, selected }
    })
    const bearer = token.selected.accessToken
    const tokenOpened = observe(reveal(token.session, token.selected.ranges, 'token-attestation'))
    const identity = await operation(emit, 'identity-fetch', async () => {
      const session = await identityPrepared
      const transcript = await session.send(exchange.buildIdentityRequest(bearer))
      const body = responseJson(transcript)
      const selected = exchange.selectIdentity(transcript, bearer)
      if (!isRecord(body) || !exchange.identityResponse(body, selected))
        throw new Error('Invalid identity response')
      return { session, selected }
    })
    const identityOpened = observe(
      reveal(identity.session, identity.selected.ranges, 'identity-attestation'),
    )
    const [tokenRevealed, identityRevealed] = await Promise.all([tokenOpened, identityOpened])
    const final = observe(Promise.all([tokenRevealed.attestation, identityRevealed.attestation]))
    const proof = observe(
      circuit.prove(
        bearer,
        { openings: tokenRevealed.openings, range: token.selected.bearerRange },
        { openings: identityRevealed.openings, range: identity.selected.bearerRange },
        signal,
      ),
    )
    const [bearerLinkProof, [tokenAttestation, identityAttestation]] = await Promise.all([
      proof,
      final,
    ])
    const { userId, userName } = identity.selected
    return {
      identity: { platformId, oauthClientId: clientId, userId, userName },
      proof: { bearerLinkProof, tokenAttestation, identityAttestation },
    }
  } finally {
    controller.abort()
    circuit.destroy()
  }
}
