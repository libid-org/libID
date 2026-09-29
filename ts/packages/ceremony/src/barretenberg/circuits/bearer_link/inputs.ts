import type { CorrelatedCommitment } from '../../../notary/notarize.js'

const encoder = new TextEncoder()

/** libid-circuits v0.4.0 private bearer width. */
export const MAX_BEARER_BYTES = 128

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
  const expected = [...inputs.token_commitment, ...inputs.identity_commitment].map(
    (n) => `0x${n.toString(16).padStart(64, '0')}`,
  )
  return value.length === 64 && value.every((v, i) => v === expected[i])
}
