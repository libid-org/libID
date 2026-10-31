import { PROOF_LIFETIME_SECONDS_TELEGRAM } from '@libid/contracts/ceremony'
import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import {
  MAX_AUD_BYTES,
  PUBLIC_INPUT_COUNT,
} from '../../../barretenberg/circuits/oidc_telegram/parameters.js'
import { type OidcProof, oidcValidation } from '../../oidcValidation.js'
import type { Identity } from '../../validation.js'

/** oidc_google's layout, with the signed `iat` in the time field. */
export type TelegramProofV1 = OidcProof<'tokenIssuedAt'>

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
  timeField: 'tokenIssuedAt',
  publicInputCount: PUBLIC_INPUT_COUNT,
  maxAudBytes: MAX_AUD_BYTES,
  // The Bridge's startup rule for Telegram's client id.
  clientIdPattern: /^[0-9]+$/,
})

export const isClientId: (value: unknown) => value is string = telegram.isClientId
export const validateProof: typeof telegram.validateProof = telegram.validateProof
export const validateIdentity: (value: unknown) => Identity<'telegram'> = telegram.validateIdentity
export const buildTelegramPublicInputs: typeof telegram.buildPublicInputs =
  telegram.buildPublicInputs
export const isTelegramPublicInputs: typeof telegram.isPublicInputs = telegram.isPublicInputs
