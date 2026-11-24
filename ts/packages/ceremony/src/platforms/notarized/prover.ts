import { BearerLinkCircuit } from '../../barretenberg/circuits/bearer-link/circuit.js'
import { CeremonyError } from '../../errors.js'
import { platformTable } from '../../identity.js'
import type { IdentityRequest } from '../../notary/oauth/identity.js'
import { notarizeOAuth } from '../../notary/oauth/sessions.js'
import type { TokenRequest } from '../../notary/oauth/token.js'
import { MIN_PROOF_THREADS, workerThreads } from '../../threads.js'
import type { ProverContext } from '../context.js'
import type { PlatformId } from '../index.js'
import type { Identity } from '../validation.js'
import type { NotarizedProofV1 } from './validation.js'

/**
 * Prove a platform identity from its PKCE code flow: check multithreaded proving capability
 * upfront, redeem the authorization code before starting Barretenberg so proving startup does not
 * compete with short-lived code exchange, then overlap circuit initialization with attestation and
 * identity work before proving the bearer link from their openings.
 */
export async function proveNotarized<P extends PlatformId>(
  context: ProverContext<P> & { codeVerifier: string },
  platformId: P,
  requests: { token: TokenRequest; identity: IdentityRequest },
): Promise<{ identity: Identity<P>; proof: NotarizedProofV1 }> {
  const { emit, request, credential: code, codeVerifier } = context
  const { clientId, redirectUri, clientCredential, notaryAddress } = request
  if (notaryAddress === null) throw new CeremonyError('prover', 'Missing notary address')
  // Fail before opening notary sessions or spending the authorization code on single-core devices.
  if (workerThreads() < MIN_PROOF_THREADS)
    throw new CeremonyError('zk-proof-preparation', 'Multithreaded backend unavailable')
  const input = { clientId, code, redirectUri, codeVerifier, clientCredential }
  const tokenRequest = requests.token.build(input)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  // Observe every provisional branch immediately; any failure retires sibling work.
  const observe = <T>(p: Promise<T>) => {
    void p.catch((error) => controller.abort(error))
    return p
  }
  let circuit: BearerLinkCircuit | undefined
  // Defer Barretenberg startup until the authorization code is exchanged, avoiding 8-thread CPU
  // contention during short code lifetimes while still overlapping with identity and attestations.
  const startCircuit = () => {
    circuit = new BearerLinkCircuit(emit)
    observe(circuit.outcome)
  }
  try {
    const { bearer, token, identity } = await notarizeOAuth({
      notaryAddress,
      ...requests,
      input,
      tokenRequest,
      signal,
      emit,
      observe,
      onTokenFetched: startCircuit,
    })
    const final = observe(Promise.all([token.attestation, identity.attestation]))
    const proof = observe(
      circuit!.prove(platformTable(platformId), bearer, token, identity, signal),
    )
    const [bearerLinkProof, [tokenAttestation, identityAttestation]] = await Promise.all([
      proof,
      final,
    ])
    return {
      identity: {
        platformId,
        oauthClientId: clientId,
        userId: identity.id.value,
        userName: identity.handle.value,
      },
      proof: { bearerLinkProof, tokenAttestation, identityAttestation },
    }
  } finally {
    controller.abort()
    circuit?.destroy()
  }
}
