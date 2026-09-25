import { dirname, join, resolve } from 'node:path'
import type { Node } from 'estree'
import { type Plugin, transformWithEsbuild } from 'vite'
import type { ResolvedAssets } from './assets.ts'
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
      const edits: { start: number; end: number; text: string }[] = []
      const span = (node: Node) => node as Node & { start: number; end: number }
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        const node = value as Node
        if (
          node.type === 'VariableDeclarator' &&
          node.id.type === 'Identifier' &&
          node.init?.type === 'CallExpression' &&
          method(node.init.callee) === 'archive'
        )
          archives.add(node.id.name)
        if (node.type === 'CallExpression') {
          const name = method(node.callee)
          if (name === 'archive' || name === 'file') {
            const source = node.arguments[0],
              mount = node.arguments[1]
            if (!source || !mount) throw new Error('Missing resource source/mount')
            edits.push({ start: span(source).start, end: span(source).end, text: 'undefined' })
            if (node.arguments.length > 2)
              edits.push({
                start: span(mount).end,
                end: span(node.arguments.at(-1)!).end,
                text: '',
              })
          }
          const callee = node.callee
          if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'member' &&
            ((callee.object.type === 'Identifier' && archives.has(callee.object.name)) ||
              (callee.object.type === 'CallExpression' &&
                method(callee.object.callee) === 'archive')) &&
            node.arguments.length > 1
          )
            edits.push({
              start: span(node.arguments[0]).end,
              end: span(node.arguments.at(-1)!).end,
              text: '',
            })
        }
        if (node.type === 'ObjectExpression') {
          const props = node.properties
          for (let i = 0; i < props.length; i++) {
            const prop = props[i]
            if (
              prop.type === 'Property' &&
              prop.key.type === 'Identifier' &&
              prop.key.name === 'bundledUrlModules'
            )
              edits.push({
                start: i ? span(props[i - 1]).end : span(prop).start,
                end: i ? span(prop).end : props.length > 1 ? span(props[1]).start : span(prop).end,
                text: '',
              })
          }
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(visit)
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(ast)
      if (!edits.length) return
      let result = code
      for (const edit of edits.sort((a, b) => b.start - a.start))
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
      return { code: result, map: null }
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
        export function resolve(asset){if(!asset.url)throw new Error('Missing built asset');return asset.isExternal ? asset.url : new URL(asset.url,location.origin).href}
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
