import { assetUrl } from '../../../assets/index.js'
import { type OperationEvent, operation } from '../../../events.js'
import { plaintextOpening } from '../../../notary/notarize.js'
import type { ByteRange, CommitmentOpening } from '../../../notary/protocol.js'
import { ProofEngine } from '../../engine.js'
import { circuit, verificationKey } from './bearerLink.assets.js'
import { buildBearerLinkInputs, isBearerLinkPublicInputs } from './inputs.js'

type BearerOpening = { openings: readonly CommitmentOpening[]; range: ByteRange }

/** Starts the circuit backend before notarization; the caller destroys it in `finally`. */
export class BearerLinkCircuit {
  private readonly engine: ProofEngine

  constructor(private readonly emit: (event: OperationEvent) => void) {
    this.engine = new ProofEngine({
      circuitUrl: assetUrl(circuit),
      verificationKeyUrl: assetUrl(verificationKey),
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
    const inputs = await operation(this.emit, 'circuit-inputs', () => {
      const plaintext = new TextEncoder().encode(bearer)
      return buildBearerLinkInputs(
        bearer,
        plaintextOpening(token.openings, 'received', token.range, plaintext),
        plaintextOpening(identity.openings, 'sent', identity.range, plaintext),
      )
    })
    const raw = await this.engine.prove(inputs, signal)
    if (!isBearerLinkPublicInputs(raw.publicInputs, inputs))
      throw new Error('Bearer public input mismatch')
    return raw.proof
  }

  /** Release the worker even when input preparation or a concurrent attestation fails. */
  destroy(): void {
    this.engine.destroy()
  }
}
