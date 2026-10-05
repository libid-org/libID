import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { stringify } from 'smol-toml'
import { safePath } from './archive.ts'

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
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
} as const

const BROTLI_QUALITY = 6
const GZIP_LEVEL = 6

const sidecars = [
  [
    '.br',
    (bytes: Buffer) =>
      brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }),
  ],
  ['.gz', (bytes: Buffer) => gzipSync(bytes, { level: GZIP_LEVEL })],
] as const

/** Emit the static files, their precompressed sidecars and the native SWS configuration. */
export function writeDistribution(out: string, records: ReadonlyMap<string, PublicRecord>) {
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
  for (const [path, { bytes, headers }] of records) {
    const physical = /^\/ccdp\/v[1-9][0-9]*\/(prefetch|prover|prover\/fallback)$/.test(path)
      ? `${path.replace(/\/fallback$/, '-fallback')}.html`
      : path
    files[path] = physical
    if (physical !== path) rewrites.push({ source: path, destination: physical })
    const target = join(out, 'public', physical)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    for (const [extension, encode] of sidecars) {
      const encoded = encode(bytes)
      // Rebuilds must not leave a previous body available through content negotiation.
      if (encoded.length < bytes.length) writeFileSync(target + extension, encoded)
      else rmSync(target + extension, { force: true })
    }
    rules.push({ source: physical, headers })
  }
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
