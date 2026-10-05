import { toCeremonyError } from '../../errors.js'
import { type OperationEvent, operation } from '../../events.js'
import { isRecord } from '../../primitives.js'
import { responseJson } from '../http.js'
import type { ExactHttpRequest, Reveals } from '../protocol.js'
import { NotaryRuntime, type NotarySession } from '../session.js'
import type { IdentityRequest } from './identity.js'
import type { TokenRequest, TokenRequestInput } from './token.js'

/** Attribute a failure to the operation it interrupted. */
const failsAs = <T>(p: Promise<T>, event: string) =>
  p.catch((error): never => {
    throw toCeremonyError(error, event)
  })

/**
 * Notarize the token request, then the identity request that spends its bearer. Both
 * sessions are prepared at once, before the bearer exists, and each reveal starts as soon as
 * its selection is known. This resolves with both sessions' openings while their final
 * attestations are still pending. `observe` hands every provisional branch to the caller,
 * which retires sibling work when one fails.
 */
export async function notarizeOAuth(options: {
  notaryAddress: string
  token: TokenRequest
  identity: IdentityRequest
  input: TokenRequestInput
  tokenRequest: ExactHttpRequest
  signal: AbortSignal
  emit: (event: OperationEvent) => void
  observe: <T>(p: Promise<T>) => Promise<T>
}) {
  const { input, tokenRequest, emit, observe } = options
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
  const notary = new NotaryRuntime(options.notaryAddress, options.signal, emit)
  const tokenPrepared = branch(
    notary.prepare(tokenRequest.url, { fetch: 'token-fetch', attestation: 'token-attestation' }),
    'token-fetch',
  )
  const identityPrepared = branch(
    notary.prepare(options.identity.url, {
      fetch: 'identity-fetch',
      attestation: 'identity-attestation',
    }),
    'identity-fetch',
  )
  const token = await operation(emit, 'token-fetch', async () => {
    const session = await tokenPrepared
    const transcript = await session.send(tokenRequest)
    const body = responseJson(transcript)
    const selected = options.token.select(transcript, input)
    if (!isRecord(body) || body.access_token !== selected.bearer)
      throw new Error('Invalid token response')
    return { session, selected }
  })
  const bearer = token.selected.bearer
  const tokenOpened = observe(reveal(token.session, token.selected.ranges, 'token-attestation'))
  const identity = await operation(emit, 'identity-fetch', async () => {
    const session = await identityPrepared
    const transcript = await session.send(options.identity.build(bearer))
    const body = responseJson(transcript)
    const selected = options.identity.select(transcript, bearer)
    if (!isRecord(body) || !options.identity.isResponse(body, selected))
      throw new Error('Invalid identity response')
    return { session, selected }
  })
  const identityOpened = observe(
    reveal(identity.session, identity.selected.ranges, 'identity-attestation'),
  )
  const [tokenRevealed, identityRevealed] = await Promise.all([tokenOpened, identityOpened])
  const { userId, userName } = identity.selected
  return {
    bearer,
    token: {
      openings: tokenRevealed.openings,
      range: token.selected.bearerRange,
      attestation: tokenRevealed.attestation,
    },
    identity: {
      openings: identityRevealed.openings,
      range: identity.selected.bearerRange,
      attestation: identityRevealed.attestation,
      userId,
      userName,
    },
  }
}
