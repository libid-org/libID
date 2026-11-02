import * as assets from '../../../barretenberg/circuits/oidc_google/oidc_google.assets.js'
import type { ProverContext } from '../../context.js'
import { proveOidc } from '../../oidc.js'
import { prepareGoogleInputs } from './inputs.js'
import { acceptGoogleIdToken, fetchSigningKey } from './token.js'
import { isGooglePublicInputs } from './validation.js'

export async function prove(context: ProverContext<'google'>) {
  const token = acceptGoogleIdToken(context.credential, context.request.clientId)
  return proveOidc(context, {
    name: 'Google',
    assets,
    token: () => token,
    fetchSigningKey,
    prepare: prepareGoogleInputs,
    isPublicInputs: isGooglePublicInputs,
  })
}
