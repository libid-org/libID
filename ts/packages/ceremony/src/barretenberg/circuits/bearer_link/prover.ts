import { assetUrl } from '../../../assets/index.js'
import { type OperationEvent, operation } from '../../../events.js'
import { bearerOpening } from '../../../notary/notarize.js'
import type { ByteRange, CommitmentOpening } from '../../../notary/protocol.js'
import { ProofEngine } from '../../engine.js'
import { bearerCircuit, bearerVerificationKey } from './bearer_link.assets.js'
import { buildBearerLinkWitness, validateBearerLinkPublicInputs } from './inputs.js'

type BearerOpening = { openings: readonly CommitmentOpening[]; range: ByteRange }

/** Starts the circuit backend before notarization; the caller destroys it in `finally`. */
export class BearerLinkProver {
  private readonly engine: ProofEngine

  constructor(private readonly emit: (event: OperationEvent) => void) {
    this.engine = new ProofEngine({
      circuitUrl: assetUrl(bearerCircuit),
      verificationKeyUrl: assetUrl(bearerVerificationKey),
      emit,
    })
  }

  /** Prove the same bearer opens the token response and identity request commitments. */
  async prove(
    bearer: string,
    token: BearerOpening,
    identity: BearerOpening,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const inputs = await operation(this.emit, 'circuit-inputs', () =>
      buildBearerLinkWitness(
        bearer,
        bearerOpening(token.openings, 'received', token.range, bearer),
        bearerOpening(identity.openings, 'sent', identity.range, bearer),
      ),
    )
    const raw = await this.engine.prove(inputs, signal)
    if (!validateBearerLinkPublicInputs(raw.publicInputs, inputs))
      throw new Error('Bearer public input mismatch')
    return raw.proof
  }

  /** Release the worker even when input preparation or a concurrent attestation fails. */
  destroy(): void {
    this.engine.destroy()
  }
}
