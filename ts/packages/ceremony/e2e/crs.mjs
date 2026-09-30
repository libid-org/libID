// The CRS the proving assets fetch from Aztec's CDN, served locally so browser runs do not depend
// on it. build.mjs caches each declared request once, pinned by hash; the harness server answers
// those hosts from the cache through a proxy that tunnels every other host unchanged. Live CDN
// availability, CORS and ranges stay a separate qualification gate.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { TLSSocket } from 'node:tls'
import { packageDir } from '../build/sources.ts'

const cacheDir = join(packageDir, '.cache/crs')
const manifestPath = join(cacheDir, 'manifest.json')
const pins = JSON.parse(readFileSync(new URL('./crs.pins.json', import.meta.url), 'utf8'))

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Cache every external request the asset catalog declares; a changed or missing pin fails. */
export async function cacheCrs() {
  const { loadAssetCatalog, externalRequest } = await import('../build/assets.ts')
  const catalog = await loadAssetCatalog()
  const assets = new Map()
  for (const versions of Object.values(catalog.assetsByPlatform))
    for (const list of Object.values(versions))
      for (const asset of list)
        if (asset.isExternal) assets.set(`${asset.source} ${asset.range ?? ''}`.trim(), asset)
  mkdirSync(cacheDir, { recursive: true })
  const manifest = [],
    unpinned = []
  for (const [key, asset] of assets) {
    const { range, bytes } = externalRequest(asset)
    const urls = [asset.source, ...(asset.fallback ?? [])]
    const file = sha256(key)
    const path = join(cacheDir, file)
    // The body and the CDN's own response metadata, replayed as it sent them.
    if (!existsSync(path) || sha256(readFileSync(path)) !== pins[key]) {
      const { body, headers } = await download(urls, range, bytes)
      writeFileSync(path, body)
      writeFileSync(`${path}.json`, JSON.stringify(headers))
    }
    const body = readFileSync(path)
    if (pins[key] === undefined) unpinned.push(`"${key}": "${sha256(body)}"`)
    else if (sha256(body) !== pins[key]) throw new Error(`CRS request ${key} changed`)
    manifest.push({ urls, range, file, headers: JSON.parse(readFileSync(`${path}.json`, 'utf8')) })
  }
  if (unpinned.length) throw new Error(`Unpinned CRS requests:\n${unpinned.join('\n')}`)
  writeFileSync(manifestPath, JSON.stringify(manifest))
}

async function download(urls, range, bytes) {
  for (let attempt = 0; attempt < 3; attempt++)
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: range ? { Range: range } : {} })
        const body = Buffer.from(await response.arrayBuffer())
        const headers = Object.fromEntries(
          ['content-range', 'etag']
            .map((name) => [name, response.headers.get(name)])
            .filter(([, value]) => value !== null),
        )
        if (response.status === (range ? 206 : 200) && body.length === bytes)
          return { body, headers }
      } catch {
        // The next source or attempt.
      }
    }
  throw new Error(`CRS unavailable: ${urls[0]} ${range ?? ''}`)
}

const entries = () => JSON.parse(readFileSync(manifestPath, 'utf8'))

/** Hosts the cached CRS is served for; the harness certificate must name them. */
export const crsHosts = () => [
  ...new Set(entries().flatMap(({ urls }) => urls.map((url) => new URL(url).host))),
]

/**
 * Serve the cached CRS on `port`, presenting `certificate` for its hosts; tunnel the rest. The
 * returned `served()` counts each declared request answered, after its TLS handshake succeeded.
 */
export function serveCrs(port, certificate) {
  const cached = entries()
  const keyOf = (entry) => `${entry.urls[0]} ${entry.range ?? ''}`.trim()
  const served = new Map()
  const byUrl = new Map(cached.flatMap((entry) => entry.urls.map((url) => [url, entry])))
  const hosts = new Set(crsHosts())
  // Headers as the CDN sends them for a CORS range request.
  const cdn = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
      'ETag,Content-Length,Content-Range,Accept-Ranges,Content-Type,Last-Modified,Cache-Control',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': 'application/octet-stream',
  }
  const local = createServer((req, res) => {
    const entry = byUrl.get(`https://${req.headers.host}${req.url}`)
    // Only the declared request is served; anything else is a harness fault, never a fallback.
    if (!entry || req.method !== 'GET' || (req.headers.range ?? undefined) !== entry.range) {
      res.writeHead(502).end('Undeclared CRS request')
      return
    }
    served.set(keyOf(entry), (served.get(keyOf(entry)) ?? 0) + 1)
    const body = readFileSync(join(cacheDir, entry.file))
    res.writeHead(entry.range ? 206 : 200, {
      ...cdn,
      ...entry.headers,
      'Content-Length': body.length,
    })
    res.end(body)
  })
  const proxy = createServer((_req, res) => res.writeHead(405).end())
  proxy.on('connect', (req, client, head) => {
    const [host, port = '443'] = req.url.split(':')
    client.on('error', () => {})
    if (hosts.has(host)) {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      const secure = new TLSSocket(client, { isServer: true, ...certificate })
      if (head.length) client.unshift(head)
      local.emit('connection', secure)
      return
    }
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client).pipe(upstream)
    })
    upstream.on('error', () => client.destroy())
  })
  proxy.listen(port, '127.0.0.1')
  return {
    served: () => ({ expected: cached.map(keyOf), counts: Object.fromEntries(served) }),
  }
}
