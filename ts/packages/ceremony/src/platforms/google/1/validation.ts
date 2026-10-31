import { PLATFORM_GOOGLE_KEY } from '@libid/contracts/platforms'
import {
  MAX_AUD_BYTES,
  PUBLIC_INPUT_COUNT,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { type OidcProof, oidcValidation } from '../../oidcValidation.js'
import type { Identity } from '../../validation.js'

export type GoogleProofV1 = OidcProof<'tokenExpiresAt'>

/** Google's signed JWT exp alone determines proof expiry. */
export const proofExpiresAt = (proof: GoogleProofV1): number => proof.tokenExpiresAt

const google = oidcValidation({
  platform: PLATFORM_GOOGLE_KEY,
  name: 'Google',
  timeField: 'tokenExpiresAt',
  publicInputCount: PUBLIC_INPUT_COUNT,
  maxAudBytes: MAX_AUD_BYTES,
})

export const isClientId: (value: unknown) => value is string = google.isClientId
export const validateProof: typeof google.validateProof = google.validateProof
export const validateIdentity: (value: unknown) => Identity<'google'> = google.validateIdentity
export const buildGooglePublicInputs: typeof google.buildPublicInputs = google.buildPublicInputs
export const isGooglePublicInputs: typeof google.isPublicInputs = google.isPublicInputs
