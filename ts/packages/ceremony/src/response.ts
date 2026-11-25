/**
 * Bound bytes while reading, not after allocating an attacker-sized response. When `exact` is
 * true, `maximum` is a trusted declared length, so chunks write straight into one buffer instead
 * of retaining intermediate chunks and doubling peak memory.
 */
export async function readBody(
  response: Response,
  maximum: number,
  exact = false,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const target = exact ? new Uint8Array(maximum) : undefined
  const chunks = target ? undefined : ([] as Uint8Array[])
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const next = length + value.length
      if (next > maximum) throw new Error('Response exceeds limit')
      if (target) target.set(value, length)
      else chunks!.push(value)
      length = next
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  if (target) return length === maximum ? target : target.slice(0, length)
  // A copy loop rather than a spread: large assets arrive in thousands of chunks.
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks!) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Strict UTF-8 JSON under the same read bound; native parsing keeps a duplicate key's last value. */
export async function readJson(response: Response, maximum: number): Promise<unknown> {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readBody(response, maximum)),
  )
}

/**
 * Public JSON fetched without cookies or redirects, read under `maximum`. It bypasses the
 * browser's HTTP cache unless `cache` says otherwise.
 */
export async function fetchPublicJson(
  url: string,
  maximum: number,
  failure: string,
  signal?: AbortSignal,
  cache: RequestCache = 'no-store',
) {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache,
    redirect: 'error',
    ...(signal && { signal }),
  })
  if (!response.ok) throw new Error(`${failure}: HTTP ${response.status}`)
  return readJson(response, maximum)
}
