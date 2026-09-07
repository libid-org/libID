import { popupPlugin } from './popup.mjs'
import { build, transformWithEsbuild } from 'vite'
import { join, dirname, posix } from 'node:path'
import { packageDir } from './release.mjs'
import { assetPlugin } from './assets.mjs'
/** Compiler AST rewriting keeps inline module imports rooted at the distribution. */
function absoluteImports() {
  return {
    name: 'ceremony-absolute-imports',
    renderChunk(code, chunk) {
      const edits = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (
          [
            'ImportDeclaration',
            'ExportNamedDeclaration',
            'ExportAllDeclaration',
            'ImportExpression',
          ].includes(node.type) &&
          node.source?.type === 'Literal' &&
          /^\.\.?\//.test(node.source.value)
        )
          edits.push([
            node.source.start,
            node.source.end,
            JSON.stringify(
              `/${posix.normalize(posix.join(posix.dirname(chunk.fileName), node.source.value))}`,
            ),
          ])
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
function workerImports() {
  return {
    name: 'ceremony-worker-imports',
    enforce: 'pre',
    async transform(source, id) {
      if (!source.includes('Worker') || id.includes('?')) return
      const code = id.endsWith('.ts')
        ? (await transformWithEsbuild(source, id, { loader: 'ts', target: 'es2022' })).code
        : source
      let ast
      try {
        ast = this.parse(code)
      } catch {
        return
      }
      const edits = [],
        imports = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'NewExpression' && node.callee?.name === 'Worker') {
          const url = node.arguments[0]
          if (
            url?.type === 'NewExpression' &&
            url.callee?.name === 'URL' &&
            url.arguments[0]?.type === 'Literal' &&
            url.arguments[1]?.type === 'MemberExpression' &&
            url.arguments[1].object?.type === 'MetaProperty'
          ) {
            const name = `__ceremonyWorker${imports.length}`
            imports.push(
              `import ${name} from ${JSON.stringify(`${join(dirname(id), url.arguments[0].value)}?worker&url`)};`,
            )
            edits.push([url.start, url.end, name])
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
export async function bundle(entry, data, { selfContained = false, invoke } = {}) {
  const graph = new Map(),
    workerFiles = new Set()
  const record = (worker) => ({
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
  const entryPlugin = {
    name: 'ceremony-entry',
    resolveId(id) {
      if (id === 'virtual:ceremony-entry') return `\0${id}`
    },
    load(id) {
      if (id === '\0virtual:ceremony-entry')
        return `import {${invoke}} from ${JSON.stringify(join(packageDir, entry))};if(typeof window!=='undefined'&&Object.hasOwn(window,'__libidCeremonyInput')){const fragment=window.__libidCeremonyInput;delete window.__libidCeremonyInput;void ${invoke}(fragment)}`
    },
  }
  const plugins = (worker) => [
    workerImports(),
    entryPlugin,
    popupPlugin(),
    assetPlugin(data),
    absoluteImports(),
    record(worker),
  ]
  const assetName = (asset) => {
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
  return { output: (Array.isArray(result) ? result[0] : result).output, graph, workerFiles }
}
