import { dirname, join, resolve } from 'node:path'
import type { CallExpression, Node, ObjectExpression } from 'estree'
import type { Plugin } from 'vite'
import type { AssetRequest } from '../src/assets/index.ts'
import { assetKey } from '../src/assets/keys.ts'
import type { ResolvedAssets } from './assets.ts'
import { applyEdits, type Edit, parseModule, replacement, span, walk } from './ast.ts'
import { packageDir } from './sources.ts'

/** Exact request sets per profile and the Worker allowlist, derived from the emitted Prover. */
export type AssetManifest = {
  requestsByProfile: Record<string, AssetRequest[]>
  allowedRequests: AssetRequest[]
}

const stringLiteral = (node: Node | undefined): string | undefined =>
  node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined

/** Without `manifest`, a bundle importing it fails to build instead of reading an empty one. */
export function assetPlugin(
  data?: Pick<ResolvedAssets, 'urls' | 'moduleUrls'>,
  manifest?: AssetManifest,
): Plugin {
  return {
    name: 'ceremony-assets',
    enforce: 'pre',
    async transform(source, id) {
      if (!data || !id.endsWith('.ts') || !source.includes('assets/index.js')) return
      const { code, ast } = await parseModule(this, source, id)
      const namespaces = new Set<string>()
      const bindings = new Map<string, string>()
      const archives = new Set<string>()
      const archiveMounts = new Map<string, string>()
      for (const node of ast.body) {
        if (
          node.type !== 'ImportDeclaration' ||
          typeof node.source.value !== 'string' ||
          resolve(dirname(id), node.source.value) !== join(packageDir, 'src/assets/index.js')
        )
          continue
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(spec.local.name)
          if (spec.type === 'ImportSpecifier')
            bindings.set(
              spec.local.name,
              spec.imported.type === 'Identifier'
                ? spec.imported.name
                : String(spec.imported.value),
            )
        }
      }
      if (!namespaces.size && !bindings.size) return
      const method = (node: Node): string | undefined => {
        if (node.type === 'Identifier') return bindings.get(node.name)
        if (
          node.type === 'MemberExpression' &&
          node.object.type === 'Identifier' &&
          namespaces.has(node.object.name) &&
          node.property.type === 'Identifier'
        )
          return node.property.name
      }
      const archiveMountOf = (node: Node): string | undefined => {
        if (node.type === 'Identifier') return archiveMounts.get(node.name)
        if (node.type === 'CallExpression' && method(node.callee) === 'archive')
          return stringLiteral(node.arguments[1])
      }
      const isArchive = (node: Node) =>
        (node.type === 'Identifier' && archives.has(node.name)) ||
        (node.type === 'CallExpression' && method(node.callee) === 'archive')
      const edits: Edit[] = []
      const lowered: [number, number][] = []
      const isLowered = (node: Node) => {
        const { start, end } = span(node)
        return lowered.some(([s, e]) => start >= s && end <= e)
      }
      // Replace each local asset declaration in-place with its resolved URL so modules carry
      // only their own asset URLs and never pull a monolithic cross-platform URL table into shared.
      const lowerCall = (node: CallExpression) => {
        if (isLowered(node)) return
        const args = node.arguments
        const name = method(node.callee)
        if (name === 'file') {
          const [sourceArg, mountArg] = args
          if (!sourceArg || !mountArg) throw new Error('Missing resource source/mount')
          const mount = stringLiteral(mountArg)
          const resolved = mount === undefined ? undefined : data.urls[assetKey({ mount })]
          if (resolved === undefined)
            throw new Error(`Static local asset URL not resolved: ${mount ?? id}`)
          edits.push(replacement(node, `({url:${JSON.stringify(resolved)}})`))
          lowered.push([span(node).start, span(node).end])
          return
        }
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'member' &&
          isArchive(callee.object)
        ) {
          const mount = archiveMountOf(callee.object)
          const member = stringLiteral(args[0])
          const resolved =
            mount !== undefined && member !== undefined
              ? data.urls[assetKey({ mount, member })]
              : undefined
          if (resolved === undefined)
            throw new Error(
              `Static archive member URL not resolved: ${mount ?? id}/${member ?? ''}`,
            )
          edits.push(replacement(node, `({url:${JSON.stringify(resolved)}})`))
          lowered.push([span(node).start, span(node).end])
          return
        }
        if (name === 'archive') {
          const [sourceArg, mountArg] = args
          if (!sourceArg || !mountArg) throw new Error('Missing resource source/mount')
          edits.push(replacement(node, 'undefined'))
          lowered.push([span(node).start, span(node).end])
        }
      }
      const stripBundledUrlModules = (node: ObjectExpression) => {
        if (isLowered(node)) return
        const props = node.properties
        for (let i = 0; i < props.length; i++) {
          const prop = props[i]
          if (
            prop.type === 'Property' &&
            prop.key.type === 'Identifier' &&
            prop.key.name === 'bundledUrlModules'
          )
            edits.push([
              i ? span(props[i - 1]).end : span(prop).start,
              i ? span(prop).end : props.length > 1 ? span(props[1]).start : span(prop).end,
              '',
            ])
        }
      }
      walk(ast, (node) => {
        if (
          node.type === 'VariableDeclarator' &&
          node.id.type === 'Identifier' &&
          node.init?.type === 'CallExpression' &&
          method(node.init.callee) === 'archive'
        ) {
          archives.add(node.id.name)
          const mount = stringLiteral(node.init.arguments[1])
          if (mount !== undefined) archiveMounts.set(node.id.name, mount)
        } else if (node.type === 'CallExpression') lowerCall(node)
        else if (node.type === 'ObjectExpression') stripBundledUrlModules(node)
      })
      if (!edits.length) return
      return { code: applyEdits(code, edits), map: null }
    },
    resolveId(id) {
      if (id === 'virtual:ceremony-assets') return `\0${id}`
    },
    load(id) {
      for (const [module, url] of Object.entries(data?.moduleUrls ?? {}))
        if (id.endsWith(`/${module}`)) return `export default ${JSON.stringify(url)};`
      // Local URLs are lowered directly into their declaring modules; keep `urls` empty in built
      // bundles so no monolithic cross-platform URL map lands in shared.
      if (id === '\0virtual:ceremony-assets')
        return Object.entries({ urls: {}, ...manifest })
          .map(([k, v]) => `export const ${k}=${JSON.stringify(v)};`)
          .join('\n')
    },
    generateBundle(_, output) {
      if (!data) return
      const assetsIndex = join(packageDir, 'src/assets/index.ts')
      for (const item of Object.values(output)) {
        if (item.type !== 'chunk') continue
        const rendered = item.modules[assetsIndex]?.renderedExports ?? []
        const unlowered = rendered.filter((name) => name === 'file' || name === 'archive')
        if (unlowered.length)
          throw new Error(
            `Unlowered local asset declaration(s) (${unlowered.join(', ')}) survived in ${item.fileName}`,
          )
      }
    },
  }
}
