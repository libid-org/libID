import { validateCircuitCapacity } from './circuits.mjs'
import { responseHeaders } from './profiles.mjs'
import { build } from 'vite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { hash, circuitRelease, packageDir } from './release.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
export async function resolveAssets(outDir) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: join(packageDir, 'src/platforms/assets.ts'), formats: ['es'] },
    },
  })
  const { assetsByPlatform } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        (Array.isArray(result) ? result[0] : result).output.find((o) => o.type === 'chunk').code,
      ).toString('base64')
  )
  const declarations = Object.values(assetsByPlatform).flatMap((v) => Object.values(v).flat()),
    unique = new Map()
  for (const asset of declarations) {
    const old = unique.get(asset.id)
    if (old && JSON.stringify(old) !== JSON.stringify(asset))
      throw new Error(`Conflicting asset declaration: ${asset.id}`)
    unique.set(asset.id, asset)
  }
  const assets = [...unique.values()]
  const notaryAddress = process.env.LIBID_NOTARY_ADDRESS || 'https://notary.lib.id'
  if (new URL(notaryAddress).origin !== notaryAddress || !notaryAddress.startsWith('https://'))
    throw new Error('Invalid notary origin')
  // Immutable worker URLs identify both their bytes and execution policy.
  const policyId = hash(
    JSON.stringify(
      ['executionWorker', 'proofWorker', 'leafWorker'].map((p) =>
        responseHeaders(p, { notaryAddress }),
      ),
    ),
  ).slice(0, 12)
  const urls = {},
    moduleUrls = {},
    bodyHashes = {},
    sizes = {},
    releases = new Map()
  for (const asset of assets) {
    if (asset.mode === 'external') continue
    let bytes, filename
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
      filename = path.split('/').at(-1)
    } else if (source.startsWith('circuit:')) {
      const name = source.slice(8, -5)
      if (!releases.has(name)) releases.set(name, await circuitRelease(name))
      filename = source.slice(8)
      bytes = releases.get(name)[filename]
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
              readFileSync(join(process.env.LIBID_TLSN_BUNDLE, name)),
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
  const g1 = assets.find((asset) => asset.id === 'g1')
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
    notaryAddress,
    bodyHashes,
    sizes,
    hashBody: hash,
    requestsByProfile: {},
    allowedRequests: [],
  }
}
export function assetPlugin(data) {
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
