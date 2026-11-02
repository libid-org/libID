import { isRedirectUri } from '../../../ccdp/index.js'
import { CeremonyError } from '../../../errors.js'
import { isRecord } from '../../../primitives.js'
import { readJson, withDeadline } from '../../../response.js'
import { isPkceValue } from '../../authorization.js'
import { provider } from './provider.js'

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
/** An OAuth error code shown to the user, such as `invalid_grant`. */
const OAUTH_ERROR = /^[a-z_]{1,64}$/

/** Swap the code for an ID token through the Bridge, which adds Telegram's client secret. */
export async function swapCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  signal: AbortSignal,
): Promise<string> {
  const { codeVerifier, redirectUri } = input
  if (!isPkceValue(codeVerifier) || !isRedirectUri(redirectUri))
    throw new Error('Invalid token request')
  // A run closed before this point starts no swap.
  signal.throwIfAborted()
  const body = await withDeadline(
    signal,
    () => new CeremonyError('token-swap', 'The Bridge did not answer the token request in time'),
    async (request) => {
      const response = await fetch(new URL(provider.tokenPath, redirectUri), {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: request,
      })
      if (!response.ok) throw new CeremonyError('token-swap', 'Telegram token request failed')
      return readJson(response, MAX_TOKEN_RESPONSE_BYTES)
    },
  )
  // Telegram answers token errors with HTTP 200 and an `error` field.
  if (isRecord(body) && 'error' in body)
    throw new CeremonyError(
      'token-swap',
      typeof body.error === 'string' && OAUTH_ERROR.test(body.error)
        ? `Telegram refused the code: ${body.error}`
        : 'Telegram refused the code',
    )
  if (!isRecord(body) || typeof body.id_token !== 'string' || !body.id_token)
    throw new CeremonyError('token-swap', 'Telegram returned no ID token')
  return body.id_token
}
