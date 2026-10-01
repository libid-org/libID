import { Parser } from 'tar'
import { readSource } from './sources.ts'

export function safePath(path: string, selector = false): string {
  const parts = path.split('/')
  // Empty components also reject empty and absolute paths.
  if (
    /[\\?#%:[\]{} \p{Cc}]/u.test(path) ||
    parts.some((p) => !p || p === '.' || p === '..') ||
    (!selector && path.includes('*')) ||
    parts.at(-1)!.includes('*')
  )
    throw new Error(`Invalid resource path: ${path}`)
  return path
}

/** Read regular files into memory; archive entries never get filesystem write authority. */
export async function readArchive(source: string, sha256?: string): Promise<Map<string, Buffer>> {
  const bytes = await readSource(source, sha256)
  const files = new Map<string, Buffer>()
  const entries = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true })
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.on('entry', (entry) => {
      try {
        const path = entry.path.replace(/^(\.\/)+/, '').replace(/\/$/, '')
        // The archive root directory has no path of its own.
        if (path || entry.type !== 'Directory') {
          safePath(path)
          if (entries.has(path)) throw new Error(`Duplicate archive entry: ${path}`)
          entries.add(path)
        }
        if (entry.type === 'Directory') {
          entry.resume()
          return
        }
        if (entry.type !== 'File' && entry.type !== 'OldFile')
          throw new Error(`Unsupported archive entry: ${path}`)
        const chunks: Buffer[] = []
        entry.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        entry.on('end', () => files.set(path, Buffer.concat(chunks)))
        entry.on('error', reject)
      } catch (error) {
        parser.abort(error as Error)
      }
    })
    parser.end(bytes)
  })
  for (const path of entries) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++)
      if (files.has(parts.slice(0, i).join('/')))
        throw new Error('Archive file/directory collision')
  }
  return files
}

export function selectMember(files: ReadonlyMap<string, Buffer>, selector: string): string {
  safePath(selector, true)
  const pattern = new RegExp(
    '^' +
      selector
        .split('*')
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*') +
      '$',
  )
  const matches = [...files.keys()].filter((path) => pattern.test(path))
  if (matches.length !== 1) throw new Error(`Archive member must match exactly once: ${selector}`)
  return matches[0]
}
