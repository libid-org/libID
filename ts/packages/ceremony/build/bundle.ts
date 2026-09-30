import { dirname, join, posix, relative } from 'node:path'
import type { NewExpression } from 'estree'
import type { Plugin, Rollup } from 'vite'
import { build } from 'vite'
import { type AssetManifest, assetPlugin } from './assetPlugin.ts'
import type { ResolvedAssets } from './assets.ts'
import { applyEdits, type Edit, parseModule, replacement, walk } from './ast.ts'
import { consumeFragment } from './fragment.ts'
import { popupFallback } from './popup.ts'
import { policyId } from './profiles.ts'
import { hash, packageDir } from './sources.ts'

/**
 * Import a `src` module into this Node process. The sources resolve one another
 * through `.js` specifiers, which only the bundler maps back to `.ts`, so the
 * module is compiled into one self-contained chunk and loaded from a data URL.
 */
export async function importSource<T>(entry: string, plugins: Plugin[] = []): Promise<T> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins,
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  })
  const output = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output
  const code = output.find((o) => o.type === 'chunk')!
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code.code).toString('base64')}`
  )) as T
}

export type BundleNode = {
  entry: string | null
  modules: string[]
  dependencies: string[]
}

/** Vite's worker-URL import query; graph modules carry it as their id suffix. */
export const workerUrl = '?worker&url'

/** A plugin named `name` serving `code` as the module `virtual:<name>`. */
const virtualModule = (name: string, code: string): Plugin => ({
  name,
  resolveId: (id) => (id === `virtual:${name}` ? `\0${id}` : undefined),
  load: (id) => (id === `\0virtual:${name}` ? code : undefined),
})

/** Compiler AST rewriting keeps inline module imports rooted at the distribution. */
function absoluteImports(): Plugin {
  return {
    name: 'ceremony-absolute-imports',
    renderChunk(code, chunk) {
      const edits: Edit[] = []
      walk(this.parse(code), (node) => {
        // Static and dynamic imports and re-exports are the nodes with a module `source`.
        if (
          'source' in node &&
          node.source?.type === 'Literal' &&
          typeof node.source.value === 'string' &&
          /^\.\.?\//.test(node.source.value)
        )
          edits.push(
            replacement(
              node.source,
              JSON.stringify(
                `/${posix.normalize(posix.join(posix.dirname(chunk.fileName), node.source.value))}`,
              ),
            ),
          )
      })
      return { code: applyEdits(code, edits), map: null }
    },
  }
}

/** The literal of `new Worker(new URL('<literal>', import.meta.url))`, if `node` is one. */
function workerUrlLiteral({ callee, arguments: [url] }: NewExpression): string | undefined {
  if (
    callee.type === 'Identifier' &&
    callee.name === 'Worker' &&
    url?.type === 'NewExpression' &&
    url.callee.type === 'Identifier' &&
    url.callee.name === 'URL' &&
    url.arguments[0]?.type === 'Literal' &&
    typeof url.arguments[0].value === 'string' &&
    url.arguments[1]?.type === 'MemberExpression' &&
    url.arguments[1].object?.type === 'MetaProperty'
  )
    return url.arguments[0].value
}

/** Make native Worker URL dependencies ordinary bundler edges, including dependency workers. */
function workerImports(): Plugin {
  return {
    name: 'ceremony-worker-imports',
    enforce: 'pre',
    async transform(source, id) {
      if (!source.includes('Worker') || id.includes('?')) return
      const parsed = await parseModule(this, source, id).catch(() => undefined)
      if (!parsed) return
      const edits: Edit[] = [],
        imports: string[] = []
      walk(parsed.ast, (node) => {
        if (node.type !== 'NewExpression') return
        const literal = workerUrlLiteral(node)
        if (literal === undefined) return
        const name = `__ceremonyWorker${imports.length}`
        imports.push(
          `import ${name} from ${JSON.stringify(`${join(dirname(id), literal)}${workerUrl}`)};`,
        )
        edits.push(replacement(node.arguments[0], name))
      })
      if (!edits.length) return
      return { code: `${imports.join('\n')}\n${applyEdits(parsed.code, edits)}`, map: null }
    },
  }
}

export async function bundle(
  entry: string,
  data: ResolvedAssets,
  {
    selfContained = false,
    invoke,
    fragment = false,
    groupModules = true,
    manifest,
  }: {
    /** One inlined chunk without module groups or imports. */
    selfContained?: boolean
    /** The entry export the generated entry starts, with the captured launch fragment when `fragment`. */
    invoke?: string
    fragment?: boolean
    groupModules?: boolean
    manifest?: AssetManifest
  } = {},
) {
  const graph = new Map<string, BundleNode>(),
    workerFiles = new Set<string>()
  const record = (worker: boolean): Plugin => ({
    name: 'ceremony-emitted-graph',
    generateBundle(_, output) {
      for (const item of Object.values(output)) {
        if (worker) workerFiles.add(item.fileName)
        if (item.type === 'chunk')
          graph.set(item.fileName, {
            entry: item.facadeModuleId,
            modules: Object.keys(item.modules),
            dependencies: [
              ...item.imports,
              ...item.dynamicImports,
              ...item.referencedFiles,
              ...(item.viteMetadata?.importedAssets ?? []),
            ],
          })
      }
    },
  })
  const start = fragment ? consumeFragment(invoke!) : `${invoke}()`
  const plugins = (worker: boolean) => [
    workerImports(),
    virtualModule(
      'ceremony-entry',
      `import {${invoke}} from ${JSON.stringify(join(packageDir, entry))};${start}`,
    ),
    virtualModule(
      'ceremony-popup-fallback',
      popupFallback.module
        ? `export {fallback} from ${JSON.stringify(popupFallback.module)}`
        : 'export const fallback=undefined',
    ),
    assetPlugin(data, manifest),
    absoluteImports(),
    record(worker),
  ]
  const assetName = (asset: Rollup.PreRenderedAsset) => {
    const digest = hash(asset.source)
    const owned = Object.entries(data.bodyHashes).find(([, bodyHash]) => bodyHash === digest)
    return owned ? owned[0].slice(1) : `ccdp/assets/${policyId}/[name]-[hash][extname]`
  }
  const chunkName = `ccdp/assets/${policyId}/[name]-[hash].js`,
    output = { entryFileNames: chunkName, chunkFileNames: chunkName, assetFileNames: assetName }
  const result = await build({
    configFile: false,
    root: packageDir,
    base: '/',
    logLevel: 'warn',
    plugins: plugins(false),
    worker: {
      format: 'es',
      plugins: () => plugins(true),
      rollupOptions: { output },
    },
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      modulePreload: false,
      rollupOptions: {
        input: invoke ? 'virtual:ceremony-entry' : join(packageDir, entry),
        preserveEntrySignatures: 'strict',
        output: {
          ...output,
          inlineDynamicImports: selfContained,
          manualChunks:
            selfContained || !groupModules
              ? undefined
              : (id) => {
                  // Classify by package path: the checkout's own path may contain `/src/`.
                  const path = relative(packageDir, id)
                  // Circuits follow the platforms that import them, as platform modules do.
                  if (path.startsWith('src/barretenberg/circuits/')) return
                  if (path.startsWith('src/barretenberg/')) return 'proof-engine'
                  // The catalog validates attestations with the decoder and its constants;
                  // only the notary runtime stays in a chunk that a profile without it skips.
                  if (
                    path.startsWith('src/notary/') &&
                    !/^src\/notary\/(decode|limits|protocol)\.ts$/.test(path)
                  )
                    return 'notary'
                  // Platform modules, the prover table among them, stay out of the shared
                  // chunk: on a chunk every prover imports, the table would put every
                  // prover in every profile's set.
                  if (
                    path.startsWith('src/') &&
                    !path.startsWith('src/platforms/') &&
                    path !== 'src/ccdp/documents/prover.ts'
                  )
                    return 'shared'
                },
        },
      },
    },
  })
  for (const node of graph.values())
    for (const module of node.modules) {
      if (module.endsWith(workerUrl)) {
        const child = [...graph.entries()].find(
          ([, v]) => v.entry === module.slice(0, -workerUrl.length),
        )
        if (!child) throw new Error(`Missing worker graph entry: ${module}`)
        node.dependencies.push(child[0])
      }
    }
  return {
    output: ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output,
    graph,
    workerFiles,
  }
}
