import * as assets from '../../../barretenberg/circuits/oidc_telegram/oidc_telegram.assets.js'
import { operation } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { proveOidc } from '../../oidc.js'
import { prepareTelegramInputs } from './inputs.js'
import { swapCode } from './swap.js'
import { acceptTelegramIdToken, fetchSigningKey } from './token.js'
import { isTelegramPublicInputs } from './validation.js'

export async function prove(context: ProverContext<'telegram'>) {
  const { emit, request, codeVerifier, signal } = context
  const { redirectUri } = request
  return proveOidc(context, {
    name: 'Telegram',
    assets,
    token: async () =>
      acceptTelegramIdToken(
        await operation(emit, 'token-swap', () =>
          swapCode({ code: context.credential, codeVerifier, redirectUri }, signal),
        ),
        request.clientId,
      ),
    fetchSigningKey: (kid, keySignal) => fetchSigningKey(redirectUri, kid, keySignal),
    prepare: prepareTelegramInputs,
    isPublicInputs: isTelegramPublicInputs,
  })
}
