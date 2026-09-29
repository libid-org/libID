import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDir = fileURLToPath(new URL('../', import.meta.url))

export const cache = join(packageDir, '.cache')

/** Internal cache/bundler identity, not a source integrity requirement. */
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function download(url: string): Promise<Buffer> {
  const path = join(cache, 'downloads', encodeURIComponent(url))
  if (existsSync(path)) return readFileSync(path)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Release download failed: ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  mkdirSync(join(cache, 'downloads'), { recursive: true })
  writeFileSync(path, bytes)
  return bytes
}

/** Read an HTTPS source through the download cache, or a path relative to this package. */
export async function readSource(source: string): Promise<Buffer> {
  return source.startsWith('https:') ? download(source) : readFileSync(resolve(packageDir, source))
}
