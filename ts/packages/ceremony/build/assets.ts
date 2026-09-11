import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Rollup } from 'vite'
import { build } from 'vite'
import type { Asset, AssetRequest, ExternalAsset, LocalAsset } from '../src/assets/index.js'
import * as headers from '../src/ccdp/headers.ts'
import { readArchive, safePath, selectMember } from './archive.ts'
import { assetPlugin } from './asset-plugin.ts'
import { validateCircuitCapacity } from './circuits.ts'
import { responseHeaders } from './profiles.ts'
import { download, hash, packageDir } from './release.ts'

export { assetPlugin } from './asset-plugin.ts'

const require = createRequire(import.meta.url)

export async function loadAssetCatalog() {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [assetPlugin()],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(packageDir, 'src/platforms/platforms.assets.ts'), formats: ['es'] },
    },
  })
  const output = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output
  const code = output.find((o) => o.type === 'chunk')!
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code.code).toString('base64')}`
  )) as {
    assetsByPlatform: Record<string, Record<number, readonly Asset[]>>
    circuits: readonly LocalAsset[]
    SRS_SIZE: number
  }
}

export function mediaType(path: string): string {
  return path.endsWith('.js') || path.endsWith('.mjs')
    ? headers.javascript['Content-Type']
    : path.endsWith('.wasm')
      ? headers.wasm['Content-Type']
      : path.endsWith('.json')
        ? headers.json['Content-Type']
        : path.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'application/octet-stream'
}

export function assetHeaders(path: string, policy: Readonly<Record<string, string>> = {}) {
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(policy)) {
    const lower = name.toLowerCase()
    if (
      seen.has(lower) ||
      ['etag', 'last-modified', 'content-length', 'content-encoding', 'content-range'].includes(
        lower,
      )
    )
      throw new Error(`Invalid declared header: ${name}`)
    seen.add(lower)
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\r\n\0]/.test(value))
      throw new Error('Invalid header')
  }
  const merged = new Headers({ ...headers.immutable, 'Content-Type': mediaType(path) })
  for (const [name, value] of Object.entries(policy)) merged.set(name, value)
  for (const [name, value] of Object.entries(headers.immutable))
    if (merged.get(name) !== value) throw new Error(`Asset policy weakened: ${name}`)
  if (merged.get('Content-Type') !== mediaType(path))
    throw new Error(`Wrong asset media type: ${path}`)
  const policyCsp = merged.get('Content-Security-Policy')
  if (policyCsp || merged.has('Cross-Origin-Embedder-Policy')) {
    if (!policyCsp || merged.get('Cross-Origin-Embedder-Policy') !== 'require-corp')
      throw new Error('Worker isolation policy missing')
    const directives = new Map<string, string[]>()
    for (const clause of policyCsp.split(';').filter((c) => c.trim())) {
      const [rawName, ...values] = clause.trim().split(/\s+/)
      const name = rawName.toLowerCase()
      if (directives.has(name)) throw new Error('Duplicate CSP directive')
      directives.set(name, values)
    }
    for (const name of ['default-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors'])
      if (directives.get(name)?.join(' ') !== "'none'") throw new Error('Worker CSP base weakened')
    const scripts = directives.get('script-src') ?? [],
      workers = directives.get('worker-src') ?? []
    if (
      !scripts.includes("'self'") ||
      !scripts.includes("'wasm-unsafe-eval'") ||
      scripts.some((s) => !["'self'", "'wasm-unsafe-eval'"].includes(s)) ||
      !workers.length ||
      workers.some((s) => !["'none'", "'self'", 'blob:'].includes(s)) ||
      (workers.includes("'none'") && workers.length !== 1)
    )
      throw new Error('Worker code policy weakened')
  }
  return Object.fromEntries(merged)
}

export function externalRequest(asset: ExternalAsset): AssetRequest {
  for (const source of [asset.source, ...(asset.fallback ?? [])]) {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('Invalid external URL')
  }
  let bytes = asset.bytes
  if (asset.range) {
    const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(asset.range)
    if (!match) throw new Error('Invalid external range')
    const size = Number(match[2]) - Number(match[1]) + 1
    if (
      !Number.isSafeInteger(Number(match[2])) ||
      size <= 0 ||
      (bytes !== undefined && bytes !== size)
    )
      throw new Error('Invalid external range size')
    bytes = size
  }
  if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes <= 0))
    throw new Error('Invalid external size')
  return { url: asset.source, range: asset.range, bytes }
}

function installedFile(source: string): Buffer {
  const path = source.slice(4),
    parts = path.split('/'),
    pkg = path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  let directory = dirname(require.resolve(pkg))
  while (
    !existsSync(join(directory, 'package.json')) ||
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name !== pkg
  ) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Package root missing')
    directory = parent
  }
  return readFileSync(join(directory, safePath(path.slice(pkg.length + 1))))
}

export async function resolveAssets() {
  const catalog = await loadAssetCatalog()
  const profiles = Object.fromEntries(
    Object.entries(catalog.assetsByPlatform).flatMap(([p, vs]) =>
      Object.entries(vs).map(([v, as]) => [`${p}/${v}`, as]),
    ),
  )
  const declarations = Object.values(profiles).flat()
  const archives = new Map<string, Promise<Map<string, Buffer>>>()
  const urls: Record<string, string> = {},
    moduleUrls: Record<string, string> = {},
    bodyHashes: Record<string, string> = {},
    sizes: Record<string, number> = {}
  const local = new Map<string, { bytes: Buffer; headers: Record<string, string> }>()
  const selections = new Map<string, string>(),
    mounts = new Map<string, string>()
  const register = (path: string, bytes: Buffer, policy: Record<string, string>) => {
    // WASM resources have decoded bodies; HTTP compression belongs to the static server.
    if (path.endsWith('.wasm') && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
    const old = local.get(path)
    if (old && !old.bytes.equals(bytes)) throw new Error(`Conflicting asset body: ${path}`)
    local.set(path, { bytes, headers: policy })
  }
  for (const asset of declarations) {
    if (asset.isExternal) {
      externalRequest(asset)
      continue
    }
    safePath(asset.mount)
    const key = `${asset.mount}/${asset.member ?? ''}`
    let path: string, bytes: Buffer
    if (asset.member !== undefined) {
      if (mounts.has(asset.mount) && mounts.get(asset.mount) !== asset.source)
        throw new Error('Conflicting archive mount')
      const first = !mounts.has(asset.mount)
      if (
        first &&
        [...mounts.keys()].some(
          (mount) => mount.startsWith(`${asset.mount}/`) || asset.mount.startsWith(`${mount}/`),
        )
      )
        throw new Error('Overlapping archive mounts')
      mounts.set(asset.mount, asset.source)
      let archive = archives.get(asset.source)
      if (!archive) {
        archive = readArchive(asset.source)
        archives.set(asset.source, archive)
      }
      const files = await archive
      if (first)
        for (const [member, body] of files) {
          const target = `/ccdp/assets/${asset.mount}/${member}`
          register(target, body, assetHeaders(member))
        }
      const member = selectMember(files, asset.member)
      path = `/ccdp/assets/${asset.mount}/${member}`
      bytes = files.get(member)!
    } else {
      path = `/ccdp/assets/${asset.mount}`
      bytes = asset.source.startsWith('npm:')
        ? installedFile(asset.source)
        : asset.source.startsWith('https:')
          ? await download(asset.source)
          : readFileSync(resolve(packageDir, asset.source))
    }
    const policy = assetHeaders(path, asset.headers),
      signature = JSON.stringify(policy)
    if (selections.has(path) && selections.get(path) !== signature)
      throw new Error(`Conflicting asset policy: ${path}`)
    selections.set(path, signature)
    register(path, bytes, policy)
    urls[key] = path
    for (const module of asset.bundledUrlModules ?? []) moduleUrls[module] = path
  }
  const circuits = new Map(
    catalog.circuits.map((asset) => {
      const path = urls[`${asset.mount}/${asset.member ?? ''}`]
      return [asset.member!.replace(/\.json$/, ''), local.get(path)!.bytes]
    }),
  )
  await validateCircuitCapacity(circuits, catalog.SRS_SIZE)
  for (const [path, { bytes }] of local) {
    bodyHashes[path] = hash(bytes)
    sizes[path] = bytes.length
  }
  // Bundled code changes URL when its execution policy changes, even if its code does not.
  const policyId = hash(
    JSON.stringify(
      ['executionWorker', 'proofWorker', 'leafWorker'].map((p) =>
        responseHeaders(p as 'executionWorker', {}),
      ),
    ),
  ).slice(0, 12)
  return {
    policyId,
    urls,
    moduleUrls,
    profiles,
    local,
    bodyHashes,
    sizes,
    hashBody: hash,
    requestsByProfile: {} as Record<string, AssetRequest[]>,
    allowedRequests: [] as AssetRequest[],
  }
}

export type ResolvedAssets = Awaited<ReturnType<typeof resolveAssets>>
