import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import * as headers from '../src/assets/headers.ts'
import type { Asset, AssetRequest, ExternalAsset, LocalAsset } from '../src/assets/index.ts'
import { ASSETS_PREFIX, assetKey, profileKey } from '../src/assets/keys.ts'
import { SRS_POINTS } from '../src/barretenberg/parameters.ts'
import { readArchive, safePath, selectMember } from './archive.ts'
import { assetPlugin } from './assetPlugin.ts'
import { importSource } from './bundle.ts'
import { validateCircuitCapacity } from './circuits.ts'
import { parseCsp } from './profiles.ts'
import { hash, packageDir, readSource } from './sources.ts'
import type { PublicRecord } from './sws.ts'

export function loadAssetCatalog() {
  return importSource<{
    assetsByPlatform: Record<string, Record<number, readonly Asset[]>>
    circuits: readonly LocalAsset[]
  }>(join(packageDir, 'src/platforms/platforms.assets.ts'), [assetPlugin()])
}

const mediaTypes: Readonly<Record<string, string>> = {
  '.js': headers.javascript['Content-Type'],
  '.mjs': headers.javascript['Content-Type'],
  '.wasm': headers.wasm['Content-Type'],
  '.json': headers.json['Content-Type'],
  '.html': headers.documentHeaders['Content-Type'],
}

export const mediaType = (path: string): string =>
  mediaTypes[extname(path)] ?? 'application/octet-stream'

/** Declared headers are well-formed, unique and leave representation metadata to SWS. */
export function checkDeclaredHeaders(policy: Readonly<Record<string, string>>): void {
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
}

export function assetHeaders(path: string, policy: Readonly<Record<string, string>> = {}) {
  checkDeclaredHeaders(policy)
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
    validateWorkerCsp(policyCsp)
  }
  return Object.fromEntries(merged)
}

/** A declared worker CSP keeps the locked-down base and admits only same-origin WASM code. */
function validateWorkerCsp(policy: string): void {
  const directives = parseCsp(policy)
  for (const name of ['default-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors'])
    if (directives.get(name)?.join(' ') !== "'none'") throw new Error('Worker CSP base weakened')
  const scripts = directives.get('script-src') ?? []
  const workers = directives.get('worker-src') ?? []
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

/** An installed package file, and the package version its mount's `{version}` becomes. */
function installedFile(source: string): { bytes: Buffer; version: string } {
  const path = source.slice(4)
  const parts = path.split('/')
  const pkg = path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const manifest = findPackageJSON(pkg, import.meta.url)
  if (!manifest) throw new Error('Package root missing')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  return {
    bytes: readFileSync(join(dirname(manifest), safePath(path.slice(pkg.length + 1)))),
    version,
  }
}

export async function resolveAssets() {
  const catalog = await loadAssetCatalog()
  const profiles = Object.fromEntries(
    Object.entries(catalog.assetsByPlatform).flatMap(([p, vs]) =>
      Object.entries(vs).map(([v, as]) => [profileKey(p, v), as]),
    ),
  )
  const declarations = Object.values(profiles).flat()
  const archives = new Map<string, Promise<Map<string, Buffer>>>()
  const urls: Record<string, string> = {}
  const moduleUrls: Record<string, string> = {}
  const bodyHashes: Record<string, string> = {}
  const local = new Map<string, PublicRecord>()
  const mounts = new Map<string, string>()
  const register = (path: string, bytes: Buffer, policy: Record<string, string>) => {
    const old = local.get(path)
    if (old && JSON.stringify(old.headers) !== JSON.stringify(policy))
      throw new Error(`Conflicting asset policy: ${path}`)
    // WASM resources have decoded bodies; HTTP compression belongs to the static server.
    if (path.endsWith('.wasm') && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
    if (old && !old.bytes.equals(bytes)) throw new Error(`Conflicting asset body: ${path}`)
    local.set(path, { bytes, headers: policy })
  }
  for (const asset of declarations) {
    if (asset.isExternal) {
      externalRequest(asset)
      continue
    }
    let path: string
    let bytes: Buffer
    if (asset.member !== undefined) {
      safePath(asset.mount)
      if (mounts.has(asset.mount) && mounts.get(asset.mount) !== asset.source)
        throw new Error('Conflicting archive mount')
      if (
        [...mounts.keys()].some(
          (mount) => mount.startsWith(`${asset.mount}/`) || asset.mount.startsWith(`${mount}/`),
        )
      )
        throw new Error('Overlapping archive mounts')
      mounts.set(asset.mount, asset.source)
      if (!archives.has(asset.source))
        archives.set(asset.source, readArchive(asset.source, asset.sha256))
      const files = await archives.get(asset.source)!
      const member = selectMember(files, asset.member)
      path = `${ASSETS_PREFIX}${asset.mount}/${member}`
      bytes = files.get(member)!
    } else if (asset.source.startsWith('npm:')) {
      // The installed version names the immutable path, so an upgrade cannot reuse it.
      if (!asset.mount.includes('{version}'))
        throw new Error(`An installed file's mount spells {version}: ${asset.mount}`)
      const installed = installedFile(asset.source)
      path = `${ASSETS_PREFIX}${safePath(asset.mount.replaceAll('{version}', installed.version))}`
      bytes = installed.bytes
    } else {
      path = `${ASSETS_PREFIX}${safePath(asset.mount)}`
      bytes = await readSource(asset.source, asset.sha256)
    }
    register(path, bytes, assetHeaders(path, asset.headers))
    urls[assetKey(asset)] = path
    for (const module of asset.bundledUrlModules ?? []) moduleUrls[module] = path
  }
  const circuits = new Map(
    catalog.circuits.map((asset) => {
      return [asset.member!.replace(/\.json$/, ''), local.get(urls[assetKey(asset)])!.bytes]
    }),
  )
  await validateCircuitCapacity(circuits, SRS_POINTS)
  for (const [path, { bytes }] of local) bodyHashes[path] = hash(bytes)
  return {
    urls,
    moduleUrls,
    profiles,
    local,
    bodyHashes,
  }
}

export type ResolvedAssets = Awaited<ReturnType<typeof resolveAssets>>
