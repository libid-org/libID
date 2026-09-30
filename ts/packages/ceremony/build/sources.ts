import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDir = fileURLToPath(new URL('../', import.meta.url))

export const cache = join(packageDir, '.cache')

/**
 * A build writes a fresh tree and swaps it in whole, so its output directory must be dedicated:
 * inside this worktree, neither this package nor an ancestor of it, and either absent, empty or
 * previous output. A staging or previous tree left by an interrupted build stops the next one:
 * building past it would drop the assets that output retains.
 */
export function outputDirectory(argument: string): string {
  const out = resolve(argument),
    own = resolve(packageDir)
  if (
    !out.startsWith(`${resolve(packageDir, '../../..')}/`) ||
    own === out ||
    own.startsWith(`${out}/`) ||
    (existsSync(out) &&
      readdirSync(out).length > 0 &&
      !existsSync(join(out, 'distribution-graph.json')))
  )
    throw new Error('Output must be a dedicated directory inside this worktree')
  for (const leftover of [`${out}.building`, `${out}.previous`])
    if (existsSync(leftover))
      throw new Error(`An interrupted build left ${leftover}; restore or remove it first`)
  return out
}

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
