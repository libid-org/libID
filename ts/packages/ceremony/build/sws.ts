import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { stringify } from 'smol-toml'
import { safePath } from './archive.ts'

/**
 * Header rule sources for one served file.
 *
 * SWS 3.0.0-beta.1 (`src/custom_headers.rs`) matches `[[advanced.headers]]`
 * sources against the request path after internal rewrites. When a file was
 * resolved and `redirect-trailing-slash = false`, it first appends
 * `/<resolved file name>`, so a served `/ccdp/v1/prefetch` (rewritten to
 * `/ccdp/v1/prefetch.html`) is matched as `/ccdp/v1/prefetch.html/prefetch.html`.
 * Responses that resolved no file, such as 404s, are matched on the raw
 * request path.
 *
 * Both forms are emitted with identical headers so a future SWS that stops
 * appending the name still applies every declared policy; inserting the same
 * values twice is harmless. No wildcard source is emitted: a `/ccdp/assets/**`
 * rule also matched every 404 beneath it and marked those responses immutable.
 * The canary in `sws.test.ts` pins the current matching against the real
 * binary so a change fails loudly; then revisit this and docs/distribution.md.
 */
export const headerSources = (physical: string) => [physical, `${physical}/${basename(physical)}`]

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
  const rules: { source: string; headers: Record<string, string> }[] = []
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
    for (const source of headerSources(physical)) rules.push({ source, headers })
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
      'redirect-trailing-slash': false,
      // `GET /health` answers 200 for readiness and liveness probes.
      health: true,
      'text-charset': false,
    },
    advanced: { rewrites, headers: rules },
  }
  writeFileSync(join(out, 'sws.toml'), stringify(config))
  return files
}
