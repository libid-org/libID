import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { fixedBytes, recordValidator, uint } from '../../../primitives.js'
import { type Identity, identityValidator, proofBytes } from '../../types.js'

export interface GoogleProofV1 {
  identityProof: Uint8Array
  tokenExpiresAt: number
  signingKeyModulus: Uint8Array
}

/** Circuit-bound claims are printable ASCII without quotes, so length is the byte length. */
export const circuitText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[\x20-\x21\x23-\x7e]+$/.test(value)

/** Client identifier constraints for this platform: exactly what a signed `aud` can hold. */
export const isClientId = (value: unknown): value is string => circuitText(value, MAX_AUD_BYTES)

export const validateProof = recordValidator<GoogleProofV1>('Invalid Google proof', {
  identityProof: proofBytes,
  tokenExpiresAt: (value) => uint(value, Number.MAX_SAFE_INTEGER),
  signingKeyModulus: (value) => fixedBytes(value, RSA_MODULUS_BYTES),
})

export const validateIdentity: (value: unknown) => Identity<'google'> = identityValidator(
  'google',
  {
    oauthClientId: isClientId,
    userId: (s) => circuitText(s, MAX_SUB_BYTES),
    userName: (s) => circuitText(s, MAX_EMAIL_BYTES),
  },
)
