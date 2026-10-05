// Comparing emitted responses, and replacing the output whole.
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { PublicRecord } from './sws.ts'

/** Same bytes and the same normalized headers. */
export const sameRecord = (a: PublicRecord, b: PublicRecord) =>
  a.bytes.equals(b.bytes) && JSON.stringify(a.headers) === JSON.stringify(b.headers)

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
