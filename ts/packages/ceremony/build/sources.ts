import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDir = fileURLToPath(new URL('../', import.meta.url))

export const cache = join(packageDir, '.cache')

/** Internal cache/bundler identity, not a source integrity requirement. */
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Read an HTTPS source through the download cache, or a path relative to this package. */
export async function readSource(source: string): Promise<Buffer> {
  if (!source.startsWith('https:')) return readFileSync(resolve(packageDir, source))
  const path = join(cache, 'downloads', encodeURIComponent(source))
  if (existsSync(path)) return readFileSync(path)
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Release download failed: ${source}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  mkdirSync(join(cache, 'downloads'), { recursive: true })
  writeFileSync(path, bytes)
  return bytes
}
