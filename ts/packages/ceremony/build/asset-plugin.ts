import { dirname, join, resolve } from 'node:path'
import type { CallExpression, Node, ObjectExpression } from 'estree'
import { type Plugin, transformWithEsbuild } from 'vite'
import type { ResolvedAssets } from './assets.ts'
import { applyEdits, type Edit, replacement, span, walk } from './ast.ts'
import { packageDir } from './release.ts'

export function assetPlugin(
  data?: Pick<ResolvedAssets, 'urls' | 'moduleUrls' | 'requestsByProfile' | 'allowedRequests'>,
): Plugin {
  return {
    name: 'ceremony-assets',
    enforce: 'pre',
    async transform(source, id) {
      if (!data || !id.endsWith('.ts') || !source.includes('assets/index.js')) return
      const code = (await transformWithEsbuild(source, id, { loader: 'ts', target: 'es2022' })).code
      const ast = this.parse(code)
      const namespaces = new Set<string>(),
        bindings = new Map<string, string>(),
        archives = new Set<string>()
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
      const isArchive = (node: Node) =>
        (node.type === 'Identifier' && archives.has(node.name)) ||
        (node.type === 'CallExpression' && method(node.callee) === 'archive')
      const edits: Edit[] = []
      // Resource sources and options are build inputs; the runtime keeps only mounts and members.
      const stripCall = (node: CallExpression) => {
        const args = node.arguments,
          name = method(node.callee)
        if (name === 'archive' || name === 'file') {
          const [source, mount] = args
          if (!source || !mount) throw new Error('Missing resource source/mount')
          edits.push(replacement(source, 'undefined'))
          if (args.length > 2) edits.push([span(mount).end, span(args.at(-1)!).end, ''])
        }
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'member' &&
          isArchive(callee.object) &&
          args.length > 1
        )
          edits.push([span(args[0]).end, span(args.at(-1)!).end, ''])
      }
      const stripBundledUrlModules = ({ properties: props }: ObjectExpression) => {
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
        )
          archives.add(node.id.name)
        else if (node.type === 'CallExpression') stripCall(node)
        else if (node.type === 'ObjectExpression') stripBundledUrlModules(node)
      })
      if (!edits.length) return
      return { code: applyEdits(code, edits), map: null }
    },
    resolveId(id) {
      if (id === 'virtual:ceremony-assets') return `\0${id}`
    },
    load(id) {
      if (data && id === join(packageDir, 'src/assets/index.ts'))
        return `
        import {urls} from 'virtual:ceremony-assets';
        export * as headers from ${JSON.stringify(join(packageDir, 'src/ccdp/headers.ts'))};
        export function archive(_source,mount){return {member(member){return {url:urls[mount+'/'+member]}}}}
        export function file(_source,mount){return {url:urls[mount+'/']}}
        export function external(source,options){return {url:source,isExternal:true,...options}}
        export function assetUrl(asset){if(!asset.url)throw new Error('Missing built asset');return asset.isExternal ? asset.url : new URL(asset.url,location.origin).href}
      `
      for (const [module, url] of Object.entries(data?.moduleUrls ?? {}))
        if (id.endsWith(`/${module}`)) return `export default ${JSON.stringify(url)};`
      if (id === '\0virtual:ceremony-assets') {
        const runtime = {
          urls: data?.urls ?? {},
          requestsByProfile: data?.requestsByProfile ?? {},
          allowedRequests: data?.allowedRequests ?? [],
        }
        return Object.entries(runtime)
          .map(([k, v]) => `export const ${k}=${JSON.stringify(v)};`)
          .join('\n')
      }
    },
  }
}
