import {
  MAX_AUD_BYTES,
  MAX_EMAIL_BYTES,
  MAX_SUB_BYTES,
  RSA_MODULUS_BYTES,
} from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { fixedBytes, hasExactKeys, isRecord, text } from '../../../primitives.js'
import { type Identity, isIdentity, proofBytes } from '../../types.js'

export interface GoogleProofV1 {
  identityProof: Uint8Array
  tokenExpiresAt: number
  signingKeyModulus: Uint8Array
}

export function validateProof(v: unknown): GoogleProofV1 {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['identityProof', 'tokenExpiresAt', 'signingKeyModulus']) ||
    !proofBytes(v.identityProof) ||
    typeof v.tokenExpiresAt !== 'number' ||
    !Number.isSafeInteger(v.tokenExpiresAt) ||
    v.tokenExpiresAt < 0 ||
    !fixedBytes(v.signingKeyModulus, RSA_MODULUS_BYTES)
  )
    throw new TypeError('Invalid Google proof')
  return v as unknown as GoogleProofV1
}

export function validateIdentity(value: unknown): Identity<'google'> {
  if (
    !isIdentity(value, 'google', [MAX_AUD_BYTES, MAX_SUB_BYTES, MAX_EMAIL_BYTES]) ||
    ![value.oauthClientId, value.userId, value.userName].every((s) => printableWithoutQuote.test(s))
  )
    throw new TypeError('Invalid google identity')
  return value
}

export const printableWithoutQuote = /^[\x20-\x21\x23-\x7e]+$/

/** Client identifier constraints for this platform. */
export const isClientId = (value: unknown): value is string => text(value, MAX_AUD_BYTES)
