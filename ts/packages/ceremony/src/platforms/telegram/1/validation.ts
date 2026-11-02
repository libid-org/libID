import { PROOF_LIFETIME_SECONDS_TELEGRAM } from '@libid/contracts/ceremony'
import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { MAX_AUD_BYTES } from '../../../barretenberg/circuits/oidc_telegram/parameters.js'
import { recordValidator } from '../../../primitives.js'
import {
  isSignedTime,
  type OidcProofFields,
  oidcProofFields,
  oidcValidation,
} from '../../oidcValidation.js'
import type { Identity } from '../../validation.js'

/** oidc_google's layout, with the signed `iat` in the time field. */
export interface TelegramProofV1 extends OidcProofFields {
  tokenIssuedAt: number
}

/** The signed `iat` plus the profile's lifetime; `exp` is not used. */
export function proofExpiresAt(proof: TelegramProofV1): number {
  const expiresAt = proof.tokenIssuedAt + PROOF_LIFETIME_SECONDS_TELEGRAM
  if (!Number.isSafeInteger(expiresAt))
    throw new RangeError('Proof expiry exceeds safe integer range')
  return expiresAt
}

const telegram = oidcValidation({
  platform: PLATFORM_TELEGRAM_KEY,
  name: 'Telegram',
  proofShape: recordValidator<TelegramProofV1>('Invalid Telegram proof', {
    ...oidcProofFields,
    tokenIssuedAt: isSignedTime,
  }),
  signedTime: (proof: Pick<TelegramProofV1, 'tokenIssuedAt'>) => proof.tokenIssuedAt,
  maxAudBytes: MAX_AUD_BYTES,
})

export const isClientId: (value: unknown) => value is string = telegram.isClientId
export const validateProof: typeof telegram.validateProof = telegram.validateProof
export const validateIdentity: (value: unknown) => Identity<'telegram'> = telegram.validateIdentity
export const buildTelegramPublicInputs: typeof telegram.buildPublicInputs =
  telegram.buildPublicInputs
export const isTelegramPublicInputs: typeof telegram.isPublicInputs = telegram.isPublicInputs
