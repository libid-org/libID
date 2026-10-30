import { isRecord } from '../primitives.js'
import { fetchPublicJson } from '../response.js'

/** Bound a public JWKS response independently of any circuit's token dimensions. */
const MAX_JWKS_BYTES = 128 * 1024

const text = new TextDecoder('utf-8', { fatal: true })

/** Decode a JWT segment's JSON object, or null. */
export function jsonObject(bytes: Uint8Array | null): Record<string, unknown> | null {
  try {
    const value: unknown = bytes && JSON.parse(text.decode(bytes))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** Select the one key carrying `kid` from the key set at `url`. */
export async function fetchSigningKey(
  url: string,
  kid: string,
  signal: AbortSignal,
): Promise<unknown> {
  // A run closed before this point starts no key request.
  signal.throwIfAborted()
  // The HTTP cache applies the server's Cache-Control: Google's keys are reused, the Bridge's are not.
  const body = await fetchPublicJson(
    url,
    MAX_JWKS_BYTES,
    'Signing key request failed',
    signal,
    'default',
  )
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
  const keys = body.keys.filter((k) => isRecord(k) && k.kid === kid)
  if (keys.length !== 1) throw new Error('Signing key is not unique')
  return keys[0]
}
