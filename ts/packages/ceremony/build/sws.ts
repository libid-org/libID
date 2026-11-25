import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { stringify } from 'smol-toml'
import { safePath } from './archive.ts'
import { documentStyleSources } from './profiles.ts'
import { cache, hash } from './sources.ts'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)

/** One published path: its bytes and the headers SWS serves with them. */
export type PublicRecord = { bytes: Buffer; headers: Record<string, string> }

/**
 * Policy of every response that resolved no file, and the catch-all first rule: SWS applies
 * matching header rules in order, later ones overwriting, so each file's exact rule overwrites
 * it. `sws.test.ts` pins this against the real binary.
 */
export const errorHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': `default-src 'none'; frame-ancestors 'none'; ${documentStyleSources}`,
} as const

/** Maximum quality and standard window: the large WASM shrinks 13–23% more than at quality 6. */
const BROTLI_QUALITY = 11
const BROTLI_WINDOW_BITS = 24
const GZIP_LEVEL = 6

/** Formats already compressed natively (WOFF2 uses Brotli); sidecars add disk cost for <1% gain. */
const precompressed = new Set(['.woff2'])

const brotliInFlight = new Map<string, Promise<Buffer>>()

/** Brotli takes seconds per multi-MB asset at this quality, so builds reuse it by content hash. */
function brotli(bytes: Buffer): Promise<Buffer> {
  const key = hash(bytes)
  const pending = brotliInFlight.get(key)
  if (pending) return pending
  const path = join(cache, `brotli-q${BROTLI_QUALITY}-w${BROTLI_WINDOW_BITS}`, `${key}.br`)
  if (existsSync(path)) return Promise.resolve(readFileSync(path))
  const task = compressBrotli(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [constants.BROTLI_PARAM_LGWIN]: BROTLI_WINDOW_BITS,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  })
    .then((encoded) => {
      mkdirSync(dirname(path), { recursive: true })
      // Unique partial path prevents races across parallel builds and leaves no truncated entry.
      const partial = `${path}.${process.pid}.${randomUUID()}.partial`
      writeFileSync(partial, encoded)
      renameSync(partial, path)
      return encoded
    })
    .finally(() => {
      brotliInFlight.delete(key)
    })
  brotliInFlight.set(key, task)
  return task
}

const sidecars = [
  ['.br', brotli],
  ['.gz', (bytes: Buffer) => compressGzip(bytes, { level: GZIP_LEVEL })],
] as const

/** Emit the static files, their precompressed sidecars and the native SWS configuration. */
export async function writeDistribution(out: string, records: ReadonlyMap<string, PublicRecord>) {
  const files: Record<string, string> = {}
  for (const path of records.keys()) {
    if (!path.startsWith('/')) throw new Error('Invalid public path')
    safePath(path.slice(1))
    if (records.has(`${path}.br`) || records.has(`${path}.gz`) || records.has(`${path}.zst`))
      throw new Error(`Resource conflicts with negotiated sidecar: ${path}`)
  }
  const rewrites: { source: string; destination: string }[] = []
  const rules: { source: string; headers: Record<string, string> }[] = [
    { source: '/**', headers: { ...errorHeaders } },
  ]
  const tasks: Promise<void>[] = []
  for (const [path, { bytes, headers }] of records) {
    const physical = /^\/ccdp\/v[1-9][0-9]*\/(prefetch|prover|prover\/fallback)$/.test(path)
      ? `${path.replace(/\/fallback$/, '-fallback')}.html`
      : path
    files[path] = physical
    if (physical !== path) rewrites.push({ source: path, destination: physical })
    const target = join(out, 'public', physical)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    if (precompressed.has(extname(physical))) {
      for (const [extension] of sidecars) rmSync(target + extension, { force: true })
    } else {
      for (const [extension, encode] of sidecars)
        tasks.push(
          encode(bytes).then((encoded) => {
            // Rebuilds must not leave a previous body available through content negotiation.
            if (encoded.length < bytes.length) writeFileSync(target + extension, encoded)
            else rmSync(target + extension, { force: true })
          }),
        )
    }
    rules.push({ source: physical, headers })
  }
  await Promise.all(tasks)
  const config = {
    general: {
      host: '::',
      // Leave the port to deployment CLI/env; SWS file values take precedence.
      root: '/home/sws/public',
      page404: '/home/sws/public/404.html',
      'cache-control-headers': false,
      etag: true,
      compression: false,
      'compression-static': true,
      // Would add HSTS and framing policy to every response; HSTS belongs to the ingress.
      'security-headers': false,
      'directory-listing': false,
      // The header rules above assume it: off, every resolved file is matched with its name appended.
      'redirect-trailing-slash': true,
      // `GET /health` answers 200 for readiness and liveness probes.
      health: true,
      'text-charset': false,
    },
    advanced: { rewrites, headers: rules },
  }
  writeFileSync(join(out, 'sws.toml'), stringify(config))
  return files
}
