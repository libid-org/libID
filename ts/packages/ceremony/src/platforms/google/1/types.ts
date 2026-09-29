import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { fixedBytes, recordValidator, uint } from '../../../primitives.js'
import { type Identity, identityValidator, proofBytes } from '../../types.js'
import { validateGooglePublicInputs } from './publicInputs.js'

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
export const circuitText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[\x20-\x21\x23-\x7e]+$/.test(value)

/** Client identifier constraints for this platform: exactly what a signed `aud` can hold. */
export const isClientId = (value: unknown): value is string => circuitText(value, MAX_AUD_BYTES)

const proofShape = recordValidator<GoogleProofV1>('Invalid Google proof', {
  identityProof: proofBytes,
  publicInputs: (value) =>
    Array.isArray(value) &&
    value.length === 56 &&
    Array.from(value).every(
      (field) => typeof field === 'string' && field.length === 66 && /^0x[0-9a-f]{64}$/.test(field),
    ),
  tokenExpiresAt: (value) => uint(value, Number.MAX_SAFE_INTEGER),
  signingKeyModulus: (value) => fixedBytes(value, RSA_MODULUS_BYTES),
})

/** Check the payload and bind its public inputs to the client's validated identity and digest. */
export function validateProof(
  value: unknown,
  identity: Identity<'google'>,
  authorizationDigest: Uint8Array,
): GoogleProofV1 {
  const proof = proofShape(value)
  if (!validateGooglePublicInputs(proof.publicInputs, authorizationDigest, identity, proof))
    throw new Error('Google public input mismatch')
  return proof
}

export const validateIdentity: (value: unknown) => Identity<'google'> = identityValidator(
  'google',
  {
    oauthClientId: isClientId,
    userId: (s) => circuitText(s, MAX_SUB_BYTES),
    userName: (s) => circuitText(s, MAX_EMAIL_BYTES),
  },
)
