import { buildOidcGooglePublicInputs } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  PUBLIC_INPUT_COUNT,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { FIELD_HEX_CHARS, FIELD_HEX_PATTERN } from '../../../barretenberg/parameters.js'
import { isFixedBytes, isUint, recordValidator } from '../../../primitives.js'
import { type Identity, identityValidator, isProofBytes } from '../../validation.js'

export interface GoogleProofV1 {
  identityProof: Uint8Array
  /** Exact circuit fields: 56 lowercase, 0x-prefixed, 32-byte hex values. */
  publicInputs: readonly string[]
  tokenExpiresAt: number
  signingKeyModulus: Uint8Array
}

/** Google's signed JWT exp alone determines proof expiry. */
export const proofExpiresAt = (proof: GoogleProofV1): number => proof.tokenExpiresAt

/** Circuit-bound claims are printable ASCII without quotes, so length is the byte length. */
export const isCircuitText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[\x20-\x21\x23-\x7e]+$/.test(value)

/** Client identifier constraints for this platform: exactly what a signed `aud` can hold. */
export const isClientId = (value: unknown): value is string => isCircuitText(value, MAX_AUD_BYTES)

const proofShape = recordValidator<GoogleProofV1>('Invalid Google proof', {
  identityProof: isProofBytes,
  publicInputs: (value) =>
    Array.isArray(value) &&
    value.length === PUBLIC_INPUT_COUNT &&
    Array.from(value).every(
      (field) =>
        typeof field === 'string' &&
        field.length === FIELD_HEX_CHARS &&
        FIELD_HEX_PATTERN.test(field),
    ),
  tokenExpiresAt: (value) => isUint(value, Number.MAX_SAFE_INTEGER),
  signingKeyModulus: (value) => isFixedBytes(value, RSA_MODULUS_BYTES),
})

/** Check the payload and bind its public inputs to the client's validated identity and digest. */
export function validateProof(
  value: unknown,
  identity: Identity<'google'>,
  authorizationDigest: Uint8Array,
): GoogleProofV1 {
  const proof = proofShape(value)
  if (!isGooglePublicInputs(proof.publicInputs, authorizationDigest, identity, proof))
    throw new Error('Google public input mismatch')
  return proof
}

export const validateIdentity: (value: unknown) => Identity<'google'> = identityValidator(
  'google',
  {
    oauthClientId: isClientId,
    userId: (s) => isCircuitText(s, MAX_SUB_BYTES),
    userName: (s) => isCircuitText(s, MAX_EMAIL_BYTES),
  },
)

/** Flatten validated Google v1 identity/proof values into the circuit's public fields. */
export function buildGooglePublicInputs(
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  proof: Pick<GoogleProofV1, 'tokenExpiresAt' | 'signingKeyModulus'>,
): string[] {
  return buildOidcGooglePublicInputs({
    authorizationDigest,
    audience: identity.oauthClientId,
    subject: identity.userId,
    email: identity.userName,
    expiresAt: proof.tokenExpiresAt,
    modulus: proof.signingKeyModulus,
  })
}

/** Compare every circuit field in order; canonical hex makes string equality byte equality. */
export function isGooglePublicInputs(
  value: unknown,
  authorizationDigest: Uint8Array,
  identity: Identity<'google'>,
  proof: Pick<GoogleProofV1, 'tokenExpiresAt' | 'signingKeyModulus'>,
): value is string[] {
  if (!Array.isArray(value)) return false
  const expected = buildGooglePublicInputs(authorizationDigest, identity, proof)
  return value.length === expected.length && expected.every((item, index) => item === value[index])
}
