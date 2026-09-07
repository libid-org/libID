import { dirname, join, posix } from 'node:path'
import type { Node } from 'estree'
import type { ChunkMetadata, Plugin, Rollup } from 'vite'
import { build, transformWithEsbuild } from 'vite'
import type { ResolvedAssets } from './assets.ts'
import { assetPlugin } from './assets.ts'
import { popupPlugin } from './popup.ts'
import { packageDir } from './release.ts'

type Edit = readonly [start: number, end: number, replacement: string]
// Rollup supplies offsets on every parsed node; ESTree's base types omit them.
function replacement(node: Node, text: string): Edit {
  const { start, end } = node as Node & { start: number; end: number }
  return [start, end, text]
}
export type BundleNode = {
  entry: string | null
  modules: string[]
  dependencies: string[]
}
type ViteChunk = Rollup.OutputChunk & { viteMetadata?: ChunkMetadata }
/** Compiler AST rewriting keeps inline module imports rooted at the distribution. */
function absoluteImports(): Plugin {
  return {
    name: 'ceremony-absolute-imports',
    renderChunk(code, chunk) {
      const edits: Edit[] = []
      const walk = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        const node = value as Node
        if (
          (node.type === 'ImportDeclaration' ||
            node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportAllDeclaration' ||
            node.type === 'ImportExpression') &&
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
        for (const v of Object.values(node))
          if (Array.isArray(v)) v.forEach(walk)
          else if (v && typeof v === 'object') walk(v)
      }
      walk(this.parse(code))
      for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
        code = code.slice(0, start) + text + code.slice(end)
      return { code, map: null }
    },
  }
}
/** Make native Worker URL dependencies ordinary bundler edges, including dependency workers. */
function workerImports(): Plugin {
  return {
    name: 'ceremony-worker-imports',
    enforce: 'pre',
    async transform(source, id) {
      if (!source.includes('Worker') || id.includes('?')) return
      const code = id.endsWith('.ts')
        ? (await transformWithEsbuild(source, id, { loader: 'ts', target: 'es2022' })).code
        : source
      let ast: ReturnType<Rollup.PluginContext['parse']>
      try {
        ast = this.parse(code)
      } catch {
        return
      }
      const edits: Edit[] = [],
        imports: string[] = []
      const walk = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        const node = value as Node
        if (
          node.type === 'NewExpression' &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Worker'
        ) {
          const url = node.arguments[0]
          if (
            url?.type === 'NewExpression' &&
            url.callee.type === 'Identifier' &&
            url.callee.name === 'URL' &&
            url.arguments[0]?.type === 'Literal' &&
            typeof url.arguments[0].value === 'string' &&
            url.arguments[1]?.type === 'MemberExpression' &&
            url.arguments[1].object?.type === 'MetaProperty'
          ) {
            const name = `__ceremonyWorker${imports.length}`
            imports.push(
              `import ${name} from ${JSON.stringify(`${join(dirname(id), url.arguments[0].value)}?worker&url`)};`,
            )
            edits.push(replacement(url, name))
          }
        }
        for (const v of Object.values(node))
          if (Array.isArray(v)) v.forEach(walk)
          else if (v && typeof v === 'object') walk(v)
      }
      walk(ast)
      if (!edits.length) return
      let result = code
      for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
        result = result.slice(0, start) + value + result.slice(end)
      return { code: `${imports.join('\n')}\n${result}`, map: null }
    },
  }
}
export async function bundle(
  entry: string,
  data: ResolvedAssets,
  { selfContained = false, invoke }: { selfContained?: boolean; invoke?: string } = {},
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
              ...((item as ViteChunk).viteMetadata?.importedAssets ?? []),
            ],
          })
      }
    },
  })
  const entryPlugin: Plugin = {
    name: 'ceremony-entry',
    resolveId(id) {
      if (id === 'virtual:ceremony-entry') return `\0${id}`
    },
    load(id) {
      if (id === '\0virtual:ceremony-entry' && selfContained)
        return `import {${invoke}} from ${JSON.stringify(join(packageDir, entry))};${invoke}()`
      if (id === '\0virtual:ceremony-entry')
        return `import {${invoke}} from ${JSON.stringify(join(packageDir, entry))};if(typeof window!=='undefined'&&Object.hasOwn(window,'__libidCeremonyInput')){const fragment=window.__libidCeremonyInput;delete window.__libidCeremonyInput;void ${invoke}(fragment)}`
    },
  }
  const plugins = (worker: boolean) => [
    workerImports(),
    entryPlugin,
    popupPlugin(),
    assetPlugin(data),
    absoluteImports(),
    record(worker),
  ]
  const assetName = (asset: Rollup.PreRenderedAsset) => {
    const owned = Object.entries(data.bodyHashes ?? {}).find(
      ([, hash]) => hash === data.hashBody?.(asset.source),
    )
    return owned ? owned[0].slice(1) : `ccdp/assets/${data.policyId}/[name]-[hash][extname]`
  }
  const result = await build({
    configFile: false,
    root: packageDir,
    base: '/',
    logLevel: 'warn',
    plugins: plugins(false),
    worker: {
      format: 'es',
      plugins: () => plugins(true),
      rollupOptions: {
        output: {
          entryFileNames: `ccdp/assets/${data.policyId}/[name]-[hash].js`,
          chunkFileNames: `ccdp/assets/${data.policyId}/[name]-[hash].js`,
          assetFileNames: assetName,
        },
      },
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
          inlineDynamicImports: selfContained,
          entryFileNames: `ccdp/assets/${data.policyId}/[name]-[hash].js`,
          chunkFileNames: `ccdp/assets/${data.policyId}/[name]-[hash].js`,
          assetFileNames: assetName,
          manualChunks: selfContained
            ? undefined
            : (id) => {
                if (id.includes('/src/prover/engine.') || id.includes('/src/prover/bb/'))
                  return 'proof-engine'
                if (id.includes('/src/prover/notarization/')) return 'notarization'
                if (
                  id.includes('/src/') &&
                  !id.includes('/platforms/') &&
                  !id.includes('/src/ccdp/documents/prover.ts') &&
                  !id.includes('/popup/')
                )
                  return 'shared'
              },
        },
      },
    },
  })
  for (const node of graph.values())
    for (const module of node.modules) {
      if (module.endsWith('?worker&url')) {
        const child = [...graph.entries()].find(([, v]) => v.entry === module.slice(0, -11))
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
