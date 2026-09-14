import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { stringify } from 'smol-toml'
import { safePath } from './archive.ts'

/**
 * Policy of every response that resolved no file: 404s (unknown routes,
 * missing assets, `/ccdp/assets/`, `<file>/<name>`) and the trailing-slash
 * redirect of a directory path. Absent cache headers would leave a 404
 * heuristically cacheable (RFC 9110 §15.5.5), so the policy is explicit.
 *
 * SWS 3.0.0-beta.1 (`src/custom_headers.rs`) matches `[[advanced.headers]]`
 * sources against the request path after `advanced.rewrites`, so one exact
 * rule per physical file (`/ccdp/v1/prefetch.html`) covers its route and its
 * direct `.html` request. `/<resolved file name>` is appended before matching
 * only for a directory-index request (`/dir/`, or any resolved file with
 * `redirect-trailing-slash = false`); this distribution serves no directory
 * index and keeps the redirect on, so that form is never emitted: keyed on
 * `<file>/<name>`, it equals the raw path of the 404 beneath the file. A
 * response that resolved no file is matched on the raw request path, and
 * every matching rule applies in config order, later rules overwriting.
 * Hence the catch-all `/**` carrying this policy comes first: an exact rule
 * overwrites the names it declares on its own file, nothing else inherits a
 * cacheable policy, and a 200 keeps the catch-all's value for a name its
 * declaration omits (the CSP on a plain asset, inert outside documents and
 * workers, which all declare their own). The canary in `sws.test.ts` pins
 * this matching against the real binary; when it fails on a newer SWS,
 * revisit this file and docs/distribution.md.
 */
export const errorHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
} as const

/** Emit static files and native SWS configuration; no response metadata overrides. */
export function writeDistribution(
  out: string,
  records: ReadonlyMap<string, { bytes: Buffer; headers: Record<string, string> }>,
) {
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
    const compressed = brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    })
    // Rebuilds must not leave a previous body available through content negotiation.
    if (compressed.length < bytes.length) writeFileSync(`${target}.br`, compressed)
    else rmSync(`${target}.br`, { force: true })
    const gzip = gzipSync(bytes, { level: 6 })
    if (gzip.length < bytes.length) writeFileSync(`${target}.gz`, gzip)
    else rmSync(`${target}.gz`, { force: true })
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
