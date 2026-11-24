import { toCeremonyError } from '../../errors.js'
import { now, type OperationEvent, operation } from '../../events.js'
import { isRecord } from '../../primitives.js'
import { PlatformRefusal, responseJson } from '../http.js'
import type { ExactHttpRequest, Reveals } from '../protocol.js'
import { NotaryRuntime, type NotarySession } from '../session.js'
import type { IdentityRequest } from './identity.js'
import type { ExpiredCode, TokenRequest, TokenRequestInput } from './token.js'

/** OAuth's `error` vocabulary, within an event attribute's bound. */
const ERROR_CODE = /^[\x20-\x7e]{1,128}$/

/**
 * Whether `refusal` is the platform's own answer to an expired code, given after the code's
 * lifetime: both the measured answer and the lifetime must hold, never the timing alone.
 */
function expired(refusal: PlatformRefusal, proverMs: number, code: ExpiredCode | undefined) {
  return (
    code !== undefined &&
    refusal.status === code.status &&
    refusal.code === code.error &&
    (code.description === undefined || refusal.description === code.description) &&
    proverMs >= code.lifetimeSeconds * 1000
  )
}

/**
 * A platform's refusal, also as an event: unlike the failure text it is structured, so its
 * status and code reach telemetry. `prover-ms` is how long this Prover document had run, a lower
 * bound on how long the authorization code waited. A refusal of an expired code also carries
 * `reason: 'authorization-expired'`, and its failure text says what to do.
 */
function reportRefusal<T>(
  emit: (event: OperationEvent) => void,
  operation: string,
  read: () => T,
  expiredCode?: ExpiredCode,
) {
  try {
    return read()
  } catch (error) {
    if (!(error instanceof PlatformRefusal)) throw error
    const proverMs = Math.round(performance.now())
    const isExpired = expired(error, proverMs, expiredCode)
    emit({
      event: 'platform-refusal',
      timestamp: now(),
      instrumentation: {
        attributes: {
          operation,
          status: error.status,
          ...(error.code !== undefined && ERROR_CODE.test(error.code) && { error: error.code }),
          'prover-ms': proverMs,
          ...(isExpired && { reason: 'authorization-expired' }),
        },
      },
    })
    if (!isExpired || !expiredCode) throw error
    throw new Error(
      `${expiredCode.name} did not accept the sign-in: it expired after ${Math.floor(proverMs / 1000)} s, while this connection set up the proof. Check your connection and try again. ${error.message}`,
      { cause: error },
    )
  }
}

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
  /** Runs once the authorization code is exchanged for a bearer, before identity/attestation work finishes. */
  onTokenFetched?: () => void
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
  // Terminate the shared TLSN worker as soon as both final attestations land, freeing its
  // WASM heap and thread pool before peak ZK proving memory usage.
  const notaryAbort = new AbortController()
  const notarySignal = AbortSignal.any([options.signal, notaryAbort.signal])
  let identityPrepared!: Promise<NotarySession>
  const token = await operation(emit, 'token-fetch', async () => {
    const notary = new NotaryRuntime(options.notaryAddress, notarySignal, emit)
    const tokenPrepared = branch(
      notary.prepare(tokenRequest.url, {
        setup: 'token-setup',
        fetch: 'token-fetch',
        attestation: 'token-attestation',
      }),
      'token-fetch',
    )
    identityPrepared = branch(
      notary.prepare(options.identity.url, {
        setup: 'identity-setup',
        fetch: 'identity-fetch',
        attestation: 'identity-attestation',
      }),
      'identity-fetch',
    )
    const session = await tokenPrepared
    const transcript = await session.send(tokenRequest)
    const secrets = [input.code, input.codeVerifier, input.clientCredential ?? '']
    const body = reportRefusal(
      emit,
      'token-fetch',
      () => responseJson(transcript, secrets),
      options.token.expiredCode,
    )
    const selected = options.token.select(transcript, input)
    if (!isRecord(body) || body.access_token !== selected.bearer)
      throw new Error('Invalid token response')
    return { session, selected }
  })
  options.onTokenFetched?.()
  const bearer = token.selected.bearer
  const tokenOpened = observe(reveal(token.session, token.selected.ranges, 'token-attestation'))
  const identity = await operation(emit, 'identity-fetch', async () => {
    const session = await identityPrepared
    const transcript = await session.send(options.identity.build(bearer))
    const body = reportRefusal(emit, 'identity-fetch', () => responseJson(transcript, [bearer]))
    const selected = options.identity.select(transcript, bearer)
    if (!isRecord(body) || !options.identity.isResponse(body, selected))
      throw new Error('Invalid identity response')
    return { session, selected }
  })
  const identityOpened = observe(
    reveal(identity.session, identity.selected.ranges, 'identity-attestation'),
  )
  const [tokenRevealed, identityRevealed] = await Promise.all([tokenOpened, identityOpened])
  void Promise.all([tokenRevealed.attestation, identityRevealed.attestation]).then(
    () => notaryAbort.abort(),
    () => {},
  )
  const { userId, userName, bearerRange, idRange, handleRange } = identity.selected
  return {
    bearer,
    token: {
      openings: tokenRevealed.openings,
      range: token.selected.bearerRange,
      attestation: tokenRevealed.attestation,
    },
    identity: {
      openings: identityRevealed.openings,
      range: bearerRange,
      id: { value: userId, range: idRange },
      handle: { value: userName, range: handleRange },
      attestation: identityRevealed.attestation,
    },
  }
}
