import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin, Rollup } from 'vite'
import { build } from 'vite'
import type { Asset, AssetRequest } from '../src/assets.js'
import { validateCircuitCapacity } from './circuits.ts'
import { responseHeaders } from './profiles.ts'
import type { ReleaseFiles } from './release.ts'
import { circuitRelease, hash, packageDir } from './release.ts'

const require = createRequire(new URL('../package.json', import.meta.url))
/** Compiled into the browser and shared response policy; never read from browser inputs. */
export function resolveNotaryAddresses(
  override?: string,
): readonly [mainnet: string, testnet: string] {
  if (override === undefined) return ['https://notary.lib.id', 'https://testnet.notary.lib.id']
  if (new URL(override).origin !== override || !override.startsWith('https://'))
    throw new Error('Invalid notary origin')
  return [override, override]
}
export async function resolveAssets(outDir: string) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: join(packageDir, 'src/platforms/assets.ts'), formats: ['es'] },
    },
  })
  const {
    assetsByPlatform,
  }: { assetsByPlatform: Record<string, Record<number, readonly Asset[]>> } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output.find(
          (o) => o.type === 'chunk',
        )!.code,
      ).toString('base64')
  )
  const declarations = Object.values(assetsByPlatform).flatMap((v) => Object.values(v).flat()),
    unique = new Map<string, Asset>()
  for (const asset of declarations) {
    const old = unique.get(asset.id)
    if (old && JSON.stringify(old) !== JSON.stringify(asset))
      throw new Error(`Conflicting asset declaration: ${asset.id}`)
    unique.set(asset.id, asset)
  }
  const assets = [...unique.values()]
  const notaryAddresses = resolveNotaryAddresses(process.env.LIBID_NOTARY_ADDRESS)
  // Immutable worker URLs identify both their bytes and execution policy.
  const policyId = hash(
    JSON.stringify(
      (['executionWorker', 'proofWorker', 'leafWorker'] as const).map((p) =>
        responseHeaders(p, { notaryAddresses }),
      ),
    ),
  ).slice(0, 12)
  const urls: Record<string, string> = {},
    moduleUrls: Record<string, string> = {},
    bodyHashes: Record<string, string> = {},
    sizes: Record<string, number> = {},
    releases = new Map<string, ReleaseFiles>()
  for (const asset of assets) {
    if (asset.mode === 'external') continue
    let bytes: Buffer, filename: string
    const source = asset.source
    if (source.startsWith('npm:')) {
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
      bytes = readFileSync(join(directory, path.slice(pkg.length + 1)))
      filename = path.split('/').at(-1)!
    } else if (source.startsWith('circuit:')) {
      const name = source.slice(8, -5)
      if (!releases.has(name)) releases.set(name, await circuitRelease(name))
      filename = source.slice(8)
      bytes = releases.get(name)![filename]
    } else {
      if (!process.env.LIBID_TLSN_BUNDLE)
        throw new Error('LIBID_TLSN_BUNDLE must name the matched TLSNotary bundle')
      filename = source.slice(5)
      bytes = readFileSync(join(process.env.LIBID_TLSN_BUNDLE, filename))
    }
    if (asset.sha256 && hash(bytes) !== asset.sha256)
      throw new Error(`Asset hash mismatch: ${asset.id}`)
    // The TLSN wrapper's nested workers resolve its deterministic WASM sibling.
    const directory = source.startsWith('tlsn:')
      ? hash(
          Buffer.concat(
            ['tlsn_wasm.js', 'tlsn_wasm_bg.wasm'].map((name) =>
              readFileSync(join(process.env.LIBID_TLSN_BUNDLE!, name)),
            ),
          ),
        )
      : hash(bytes)
    const path = `/ccdp/assets/${policyId}/${directory.slice(0, 20)}/${filename}`
    mkdirSync(dirname(join(outDir, path)), { recursive: true })
    writeFileSync(join(outDir, path), bytes)
    urls[asset.id] = path
    bodyHashes[path] = hash(bytes)
    sizes[path] = bytes.length
    for (const module of asset.bundledUrlModules ?? []) moduleUrls[module] = path
  }
  const g1 = assets.find((asset) => asset.mode === 'external' && asset.id === 'g1')
  if (g1?.mode !== 'external') throw new Error('Missing G1 resource')
  await validateCircuitCapacity(releases, g1.bytes / 32)
  const profiles = Object.fromEntries(
    Object.entries(assetsByPlatform).flatMap(([p, vs]) =>
      Object.entries(vs).map(([v, as]) => [`${p}/${v}`, as]),
    ),
  )
  return {
    policyId,
    urls,
    moduleUrls,
    profiles,
    local: Object.values(urls),
    notaryAddresses,
    bodyHashes,
    sizes,
    hashBody: hash,
    requestsByProfile: {} as Record<string, AssetRequest[]>,
    allowedRequests: [] as AssetRequest[],
  }
}
export type ResolvedAssets = Awaited<ReturnType<typeof resolveAssets>>

export function assetPlugin(data: ResolvedAssets): Plugin {
  return {
    name: 'ceremony-assets',
    resolveId(id) {
      if (id === 'virtual:ceremony-assets') return `\0${id}`
    },
    load(id) {
      for (const [module, url] of Object.entries(data.moduleUrls ?? {}))
        if (id.endsWith(`/${module}`)) return `export default ${JSON.stringify(url)}`
      if (id === '\0virtual:ceremony-assets')
        return Object.entries(data)
          .filter(([k]) => !['bodyHashes', 'sizes', 'hashBody', 'moduleUrls'].includes(k))
          .map(([k, v]) => `export const ${k}=${JSON.stringify(v)};`)
          .join('\n')
    },
  }
}
