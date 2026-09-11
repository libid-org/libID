import type { CorrelatedCommitment } from '../../../notary/notarize.js'

const encoder = new TextEncoder()

const MAX_BEARER_BYTES = 128

function validateOpening(opening: CorrelatedCommitment, name: string, bearerLength: number): void {
  if (!(opening.blinder instanceof Uint8Array) || opening.blinder.length !== 16) {
    throw new Error(`${name} blinder must be exactly 16 bytes`)
  }
  if (!(opening.hash instanceof Uint8Array) || opening.hash.length !== 32) {
    throw new Error(`${name} commitment must be exactly 32 bytes`)
  }
  if (opening.end - opening.start !== bearerLength) {
    throw new Error(`${name} opening length must match the bearer`)
  }
}

/** Construct the exact libid-circuits v0.3.0 `bearer_link` witness. */
export function buildBearerLinkWitness(
  bearer: string,
  token: CorrelatedCommitment,
  identity: CorrelatedCommitment,
): Record<string, unknown> {
  const bytes = encoder.encode(bearer)
  if (bytes.length === 0 || bytes.length > MAX_BEARER_BYTES) {
    throw new Error('bearer must contain between 1 and 128 bytes')
  }
  if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw new Error('bearer must be printable ASCII')
  }
  validateOpening(token, 'token', bytes.length)
  validateOpening(identity, 'identity', bytes.length)

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
  inputs: Record<string, unknown>,
): boolean {
  const expected = [
    ...(inputs.token_commitment as number[]),
    ...(inputs.identity_commitment as number[]),
  ].map((n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`)
  return value.length === 64 && value.every((v, i) => v === expected[i])
}
