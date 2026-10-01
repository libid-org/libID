/** Bound bytes while reading, not after allocating an attacker-sized response. */
export async function readBody(
  response: Response,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > maximum) throw new Error('Response exceeds limit')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  // A copy loop rather than a spread: large assets arrive in thousands of chunks.
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
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

/** Public JSON fetched without cookies, redirects or persistent browser caching, read under `maximum`. */
export async function fetchPublicJson(
  url: string,
  maximum: number,
  failure: string,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    ...(signal && { signal }),
  })
  if (!response.ok) throw new Error(failure)
  return readJson(response, maximum)
}
