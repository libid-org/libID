import { assetUrl } from '../../assets/index.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../../barretenberg/circuits/bearer_link/bearer_link.assets.js'
import {
  buildBearerLinkWitness,
  validateBearerLinkPublicInputs,
} from '../../barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../../barretenberg/engine.js'
import { CeremonyError, ceremonyError } from '../../errors.js'
import { operation } from '../../events.js'
import { responseJson } from '../../notary/http.js'
import { bearerOpening } from '../../notary/notarize.js'
import type { ByteRange, ExactHttpRequest, Reveals, Transcript } from '../../notary/protocol.js'
import { Notarization, type NotarizationSession } from '../../notary/session.js'
import { isRecord } from '../../primitives.js'
import type { ProverContext } from '../context.js'

interface Selection {
  ranges: Reveals
  bearerRange: ByteRange
}

/** Shared two-attestation bearer-link pipeline; platform adapters own HTTP and identity policy. */
export async function proveBearerLink(
  context: ProverContext,
  profile: {
    tokenRequest: ExactHttpRequest
    selectToken(transcript: Transcript): Selection & { accessToken: string }
    identityUrl: string
    identityRequest(bearer: string): ExactHttpRequest
    selectIdentity(
      transcript: Transcript,
      bearer: string,
    ): Selection & { userId: string; userName: string }
  },
) {
  const { emit } = context
  const { notaryAddress } = context.request
  if (notaryAddress === null) throw new CeremonyError('prover', 'Missing notary address')
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const engine = new ProofEngine({
    circuitUrl: assetUrl(bearerCircuit),
    verificationKeyUrl: assetUrl(bearerVerificationKey),
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
    const notary = new Notarization(notaryAddress, signal, emit)
    const tokenRequest = profile.tokenRequest
    const tokenSession = observe(
      notary.prepare(tokenRequest.url, 'token-attestation').catch((e) => {
        throw ceremonyError(e, 'token-fetch')
      }),
    )
    const identitySession = observe(
      notary.prepare(profile.identityUrl, 'identity-attestation').catch((e) => {
        throw ceremonyError(e, 'identity-fetch')
      }),
    )
    const { session, selection, bearer } = await operation(emit, 'token-fetch', async () => {
      const session = await tokenSession
      const transcript = await session.send(tokenRequest)
      const body = responseJson(transcript)
      const selection = profile.selectToken(transcript)
      if (!isRecord(body) || body.access_token !== selection.accessToken)
        throw new Error('Invalid token response')
      const bearer = selection.accessToken
      return { session, selection, bearer }
    })
    const tokenReveal = observe(reveal(session, selection.ranges, 'token-attestation'))
    const { identity, selected } = await operation(emit, 'identity-fetch', async () => {
      const identity = await identitySession
      const transcript = await identity.send(profile.identityRequest(bearer))
      const selected = profile.selectIdentity(transcript, bearer)
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
    const proof = observe(engine.prove(inputs, signal))
    const [raw, [tokenAttestation, identityAttestation]] = await Promise.all([proof, final])
    if (!validateBearerLinkPublicInputs(raw.publicInputs, inputs))
      throw new Error('Bearer public input mismatch')
    return {
      identity: {
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
    controller.abort()
    engine.destroy()
  }
}
