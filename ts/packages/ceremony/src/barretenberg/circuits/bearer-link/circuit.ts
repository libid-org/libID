import type { Platform } from '@libid/contracts/platforms'
import { assetUrl } from '../../../assets/index.js'
import { type OperationEvent, operation } from '../../../events.js'
import { plaintextOpening } from '../../../notary/notarize.js'
import type { ByteRange, CommitmentOpening } from '../../../notary/protocol.js'
import { ProofEngine } from '../../engine.js'
import { circuit, verificationKey } from './bearerLink.assets.js'
import { buildBearerLinkInputs, isBearerLinkPublicInputs } from './inputs.js'

const encoder = new TextEncoder()

/** One session's provisional openings and the bearer's range in it. */
type BearerOpening = { openings: readonly CommitmentOpening[]; range: ByteRange }

/** A committed identity response value and its range. */
type CommittedValue = { value: string; range: ByteRange }

/** The identity session: its bearer, and the id and handle its response commits. */
type IdentityOpening = BearerOpening & { id: CommittedValue; handle: CommittedValue }

/** Starts the circuit backend before notarization; the caller destroys it in `finally`. */
export class BearerLinkCircuit {
  private readonly engine: ProofEngine
  /** Rejects as soon as the backend fails, before any proof is requested. */
  readonly outcome: Promise<void>

  constructor(private readonly emit: (event: OperationEvent) => void) {
    this.engine = new ProofEngine({
      circuitUrl: assetUrl(circuit),
      verificationKeyUrl: assetUrl(verificationKey),
      emit,
    })
    this.outcome = this.engine.outcome
  }

  /**
   * Prove the same bearer opens the token response and identity request commitments, and that
   * the identity response's committed id and handle hash to their nodes under `platform`'s tags.
   */
  async prove(
    platform: Platform,
    bearer: string,
    token: BearerOpening,
    identity: IdentityOpening,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const inputs = await operation(this.emit, 'circuit-inputs', () => {
      const plaintext = encoder.encode(bearer)
      const opened = ({ value, range }: CommittedValue) => ({
        value,
        opening: plaintextOpening(identity.openings, 'received', range, encoder.encode(value)),
      })
      return buildBearerLinkInputs(platform, {
        bearer,
        token: plaintextOpening(token.openings, 'received', token.range, plaintext),
        identity: plaintextOpening(identity.openings, 'sent', identity.range, plaintext),
        id: opened(identity.id),
        handle: opened(identity.handle),
      })
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
