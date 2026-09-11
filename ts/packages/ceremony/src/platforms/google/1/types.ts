import { hasExactKeys, isRecord } from '../../../primitives.js'
import { fixedBytes, type Identity, isIdentity, proofBytes } from '../../types.js'

export const MAX_HONK_PROOF_BYTES = 4 * 1024 * 1024

export const MAX_EMAIL_BYTES = 62,
  MAX_SUB_BYTES = 31,
  MAX_AUD_BYTES = 128,
  RSA_MODULUS_BYTES = 256

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
    !fixedBytes(v.signingKeyModulus, 256)
  )
    throw new TypeError('Invalid Google proof')
  return v as unknown as GoogleProofV1
}

export function validateIdentity(value: unknown): Identity<'google'> {
  if (
    !isIdentity(value, 'google', [128, 31, 62]) ||
    ![value.oauthClientId, value.userId, value.userName].every((s) => printableWithoutQuote.test(s))
  )
    throw new TypeError('Invalid google identity')
  return value
}

export const printableWithoutQuote = /^[\x20-\x21\x23-\x7e]+$/
