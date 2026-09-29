import type { CorrelatedCommitment } from '../../../notary/notarize.js'
import { fieldHex } from '../../protocol.js'
import { MAX_BEARER_BYTES, PUBLIC_INPUT_COUNT } from './parameters.js'

const encoder = new TextEncoder()

/** A circuit-width HTTP bearer: visible ASCII, so no whitespace. */
export const isBearer = (value: string): boolean =>
  value.length <= MAX_BEARER_BYTES && /^[\x21-\x7e]+$/.test(value)

/**
 * The exact libid-circuits v0.4.0 `bearer_link` witness. Openings come from bearerOpening,
 * which fixes their blinder width and bearer length.
 */
export function buildBearerLinkWitness(
  bearer: string,
  token: CorrelatedCommitment,
  identity: CorrelatedCommitment,
) {
  if (!isBearer(bearer)) throw new Error('bearer must be 1 to 128 visible ASCII bytes')
  const bytes = encoder.encode(bearer)
  const padded = new Uint8Array(MAX_BEARER_BYTES)
  padded.set(bytes)
  return {
    bearer: Array.from(padded),
    bearer_len: String(bytes.length),
    blinder_token: Array.from(token.blinder),
    blinder_identity: Array.from(identity.blinder),
    token_commitment: Array.from(token.hash),
    identity_commitment: Array.from(identity.hash),
  }
}

/** Match the two commitments in the circuit's exact public-input order. */
export function validateBearerLinkPublicInputs(
  value: readonly string[],
  inputs: ReturnType<typeof buildBearerLinkWitness>,
): boolean {
  const expected = [...inputs.token_commitment, ...inputs.identity_commitment].map(fieldHex)
  return value.length === PUBLIC_INPUT_COUNT && value.every((v, i) => v === expected[i])
}
