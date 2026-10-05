import { BearerLinkCircuit } from '../../barretenberg/circuits/bearer-link/circuit.js'
import { CeremonyError } from '../../errors.js'
import type { IdentityRequest } from '../../notary/oauth/identity.js'
import { notarizeOAuth } from '../../notary/oauth/sessions.js'
import type { TokenRequest } from '../../notary/oauth/token.js'
import type { ProverContext } from '../context.js'
import type { PlatformId } from '../index.js'
import type { Identity } from '../validation.js'
import type { NotarizedProofV1 } from './validation.js'

/**
 * Prove a platform identity from its PKCE code flow: start the circuit backend, notarize the
 * platform's token and identity requests, and, last, prove the bearer link from their
 * openings while the final attestations arrive.
 */
export async function proveNotarized<P extends PlatformId>(
  context: ProverContext<P> & { codeVerifier: string },
  platformId: P,
  requests: { token: TokenRequest; identity: IdentityRequest },
): Promise<{ identity: Identity<P>; proof: NotarizedProofV1 }> {
  const { emit, request, credential: code, codeVerifier } = context
  const { clientId, redirectUri, clientCredential, notaryAddress } = request
  if (notaryAddress === null) throw new CeremonyError('prover', 'Missing notary address')
  const input = { clientId, code, redirectUri, codeVerifier, clientCredential }
  const tokenRequest = requests.token.build(input)
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  // The backend initializes while the network work runs.
  const circuit = new BearerLinkCircuit(emit)
  // Observe every provisional branch immediately; any failure retires sibling work.
  const observe = <T>(p: Promise<T>) => {
    void p.catch((error) => controller.abort(error))
    return p
  }
  // A backend failure retires the sessions at once, not after both reveals.
  observe(circuit.outcome)
  try {
    const { bearer, token, identity } = await notarizeOAuth({
      notaryAddress,
      ...requests,
      input,
      tokenRequest,
      signal,
      emit,
      observe,
    })
    const final = observe(Promise.all([token.attestation, identity.attestation]))
    const proof = observe(circuit.prove(bearer, token, identity, signal))
    const [bearerLinkProof, [tokenAttestation, identityAttestation]] = await Promise.all([
      proof,
      final,
    ])
    const { userId, userName } = identity
    return {
      identity: { platformId, oauthClientId: clientId, userId, userName },
      proof: { bearerLinkProof, tokenAttestation, identityAttestation },
    }
  } finally {
    controller.abort()
    circuit.destroy()
  }
}
