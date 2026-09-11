import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { stringify } from 'smol-toml'
import { immutable } from '../src/ccdp/headers.ts'
import { safePath } from './archive.ts'

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
  const rules = [{ source: '/ccdp/assets/**', headers: { ...immutable } as Record<string, string> }]
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
    // With redirects disabled the pinned SWS appends the resolved filename for header matching.
    rules.push({ source: `${physical}/${basename(physical)}`, headers })
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
      'security-headers': false,
      'directory-listing': false,
      'redirect-trailing-slash': false,
      health: false,
      'text-charset': false,
    },
    advanced: { rewrites, headers: rules },
  }
  writeFileSync(join(out, 'sws.toml'), stringify(config))
  return files
}
