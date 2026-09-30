import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDir = fileURLToPath(new URL('../', import.meta.url))

export const cache = join(packageDir, '.cache')

/** The distribution's default output directory. */
export const artifactsDir = join(packageDir, 'dist-artifacts')

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

/** Hex sha256 of `bytes`; matches a bundled asset to the declared local body it duplicates. */
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A source pin as `gh release view` prints a release asset's digest. */
const PIN = /^sha256:[0-9a-f]{64}$/

const pinOf = (bytes: Uint8Array) => `sha256:${hash(bytes)}`

/**
 * Read an HTTPS source through the download cache, or a path relative to this package. An
 * HTTPS source must carry a pin and match it; a cached copy that does not is downloaded again.
 */
export async function readSource(source: string, sha256?: string): Promise<Buffer> {
  if (sha256 !== undefined && !PIN.test(sha256)) throw new Error(`Invalid sha256 pin: ${source}`)
  const checked = (bytes: Buffer) => {
    if (sha256 !== undefined && pinOf(bytes) !== sha256)
      throw new Error(`${source} does not match its pin: expected ${sha256}, got ${pinOf(bytes)}`)
    return bytes
  }
  if (!source.startsWith('https:')) return checked(readFileSync(resolve(packageDir, source)))
  if (sha256 === undefined) throw new Error(`HTTPS source needs a sha256 pin: ${source}`)
  const path = join(cache, 'downloads', encodeURIComponent(source))
  if (existsSync(path)) {
    const cached = readFileSync(path)
    if (pinOf(cached) === sha256) return cached
  }
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Release download failed: ${source}`)
  const bytes = checked(Buffer.from(await response.arrayBuffer()))
  mkdirSync(join(cache, 'downloads'), { recursive: true })
  writeFileSync(path, bytes)
  return bytes
}
