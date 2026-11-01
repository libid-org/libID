import { PLATFORM_GOOGLE_KEY } from '@libid/contracts/platforms'
import {
  MAX_AUD_BYTES,
  PUBLIC_INPUT_COUNT,
} from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { recordValidator } from '../../../primitives.js'
import {
  isSignedTime,
  type OidcProofFields,
  oidcProofFields,
  oidcValidation,
} from '../../oidcValidation.js'
import type { Identity } from '../../validation.js'

export interface GoogleProofV1 extends OidcProofFields {
  tokenExpiresAt: number
}

/** Google's signed JWT exp alone determines proof expiry. */
export const proofExpiresAt = (proof: GoogleProofV1): number => proof.tokenExpiresAt

const google = oidcValidation({
  platform: PLATFORM_GOOGLE_KEY,
  name: 'Google',
  proofShape: recordValidator<GoogleProofV1>('Invalid Google proof', {
    ...oidcProofFields(PUBLIC_INPUT_COUNT),
    tokenExpiresAt: isSignedTime,
  }),
  signedTime: (proof: Pick<GoogleProofV1, 'tokenExpiresAt'>) => proof.tokenExpiresAt,
  maxAudBytes: MAX_AUD_BYTES,
})

export const isClientId: (value: unknown) => value is string = google.isClientId
export const validateProof: typeof google.validateProof = google.validateProof
export const validateIdentity: (value: unknown) => Identity<'google'> = google.validateIdentity
export const buildGooglePublicInputs: typeof google.buildPublicInputs = google.buildPublicInputs
export const isGooglePublicInputs: typeof google.isPublicInputs = google.isPublicInputs
