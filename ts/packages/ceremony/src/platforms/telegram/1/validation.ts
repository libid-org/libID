import { PROOF_LIFETIME_SECONDS_TELEGRAM } from '@libid/contracts/ceremony'
import { PLATFORM_TELEGRAM_KEY } from '@libid/contracts/platforms'
import { buildOidcGooglePublicInputs } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import { RSA_MODULUS_BYTES } from '../../../barretenberg/circuits/oidc_google/parameters.js'
import {
  MAX_AUD_BYTES,
  PUBLIC_INPUT_COUNT,
} from '../../../barretenberg/circuits/oidc_telegram/parameters.js'
import { FIELD_HEX_CHARS, FIELD_HEX_PATTERN } from '../../../barretenberg/parameters.js'
import { identityNodes, isAccountId, isHandle } from '../../../identity.js'
import { isFixedBytes, isUint, recordValidator } from '../../../primitives.js'
import { isAudience } from '../../google/1/validation.js'
import { type Identity, identityValidator, isProofBytes } from '../../validation.js'

export interface TelegramProofV1 {
  identityProof: Uint8Array
  /** Exact circuit fields: 57 lowercase, 0x-prefixed, 32-byte hex values. */
  publicInputs: readonly string[]
  tokenIssuedAt: number
  signingKeyModulus: Uint8Array
}

/** The signed `iat` plus the profile's lifetime; `exp` is not used. */
export const proofExpiresAt = (proof: TelegramProofV1): number =>
  proof.tokenIssuedAt + PROOF_LIFETIME_SECONDS_TELEGRAM

/** The bot id as a signed `aud` can hold it. */
export const isClientId = (value: unknown): value is string => isAudience(value, MAX_AUD_BYTES)

const proofShape = recordValidator<TelegramProofV1>('Invalid Telegram proof', {
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
  tokenIssuedAt: (value) => isUint(value, Number.MAX_SAFE_INTEGER),
  signingKeyModulus: (value) => isFixedBytes(value, RSA_MODULUS_BYTES),
})

/** Check the payload and bind its public inputs to the client's validated identity and digest. */
export function validateProof(
  value: unknown,
  identity: Identity<'telegram'>,
  authorizationDigest: Uint8Array,
): TelegramProofV1 {
  const proof = proofShape(value)
  if (!isTelegramPublicInputs(proof.publicInputs, authorizationDigest, identity, proof))
    throw new Error('Telegram public input mismatch')
  return proof
}

export const validateIdentity: (value: unknown) => Identity<'telegram'> = identityValidator(
  PLATFORM_TELEGRAM_KEY,
  {
    oauthClientId: isClientId,
    userId: (s) => isAccountId(PLATFORM_TELEGRAM_KEY, s),
    userName: (s) => isHandle(PLATFORM_TELEGRAM_KEY, s),
  },
)

/** Compare every circuit field in order; oidc_telegram shares oidc_google's layout, `iat` in the time field. */
export function isTelegramPublicInputs(
  value: unknown,
  authorizationDigest: Uint8Array,
  identity: Identity<'telegram'>,
  proof: Pick<TelegramProofV1, 'tokenIssuedAt' | 'signingKeyModulus'>,
): value is string[] {
  if (!Array.isArray(value)) return false
  const expected = buildOidcGooglePublicInputs({
    authorizationDigest,
    audience: identity.oauthClientId,
    ...identityNodes(identity),
    expiresAt: proof.tokenIssuedAt,
    modulus: proof.signingKeyModulus,
  })
  return value.length === expected.length && expected.every((item, index) => item === value[index])
}
