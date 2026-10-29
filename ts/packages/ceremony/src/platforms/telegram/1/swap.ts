import { CeremonyError } from '../../../errors.js'
import { isRecord } from '../../../primitives.js'
import { readJson } from '../../../response.js'
import { provider } from './provider.js'

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024

/** Swap the code for an ID token through the Bridge, which adds Telegram's client secret. */
export async function swapCode(
  bridge: string,
  input: { code: string; codeVerifier: string; redirectUri: string },
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${bridge}${provider.tokenPath}`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) throw new CeremonyError('token-fetch', 'Telegram token request failed')
  // Telegram answers token errors with HTTP 200 and an `error` field.
  const body = await readJson(response, MAX_TOKEN_RESPONSE_BYTES)
  if (!isRecord(body) || 'error' in body || typeof body.id_token !== 'string' || !body.id_token)
    throw new CeremonyError('token-fetch', 'Telegram returned no ID token')
  return body.id_token
}
