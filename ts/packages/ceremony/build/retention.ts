// Carrying the previous output's immutable assets into a build, and replacing the output whole.
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { safePath } from './archive.ts'
import { checkDeclaredHeaders } from './assets.ts'
import type { PublicRecord } from './sws.ts'

/** Same bytes and the same normalized headers. */
export const sameRecord = (a: PublicRecord, b: PublicRecord) =>
  a.bytes.equals(b.bytes) && JSON.stringify(a.headers) === JSON.stringify(b.headers)

/** Retain old immutable assets and their effective policy through the compatibility window. */
export function retainPrevious(out: string, records: Map<string, PublicRecord>) {
  const previousGraph = join(out, 'distribution-graph.json')
  if (!existsSync(previousGraph)) return
  const previous: { headers: Record<string, Record<string, string>> } = JSON.parse(
    readFileSync(previousGraph, 'utf8'),
  )
  for (const [path, headers] of Object.entries(previous.headers)) {
    if (!path.startsWith('/ccdp/assets/')) continue
    safePath(path.slice(1))
    // A retained asset keeps the policy it was published with, so only its form is checked.
    checkDeclaredHeaders(headers)
    const record = {
        bytes: readFileSync(join(out, 'public', path)),
        headers: Object.fromEntries(new Headers(headers)),
      },
      current = records.get(path)
    if (!current) records.set(path, record)
    else if (!sameRecord(current, record)) throw new Error(`Immutable response changed: ${path}`)
  }
}

/** Replace the output with the finished staging directory, restoring it if the move fails. */
export function swapInto(staging: string, target: string) {
  if (!existsSync(target)) return renameSync(staging, target)
  const previous = `${target}.previous`
  if (existsSync(previous)) throw new Error('Previous output already exists')
  renameSync(target, previous)
  try {
    renameSync(staging, target)
  } catch (error) {
    renameSync(previous, target)
    throw error
  }
  rmSync(previous, { recursive: true })
}
