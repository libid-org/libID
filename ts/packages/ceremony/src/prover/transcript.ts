import type { ByteRange } from './notarization/notarize.js'
const decoder = new TextDecoder('utf-8', { fatal: true })
function invalid(reason: string): never {
  throw new Error(`Invalid transcript: ${reason}`)
}
function findFrom(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

export function findUnique(haystack: Uint8Array, needle: Uint8Array, name: string): number {
  const start = findFrom(haystack, needle)
  if (start < 0) return invalid(`${name} is missing`)
  if (findFrom(haystack, needle, start + 1) >= 0) return invalid(`${name} is duplicated`)
  return start
}

export function quotedRange(
  transcript: Uint8Array,
  prefix: Uint8Array,
  name: string,
): { range: ByteRange; value: Uint8Array } {
  const start = findUnique(transcript, prefix, name)
  const valueStart = start + prefix.length
  let end = valueStart
  while (end < transcript.length && transcript[end] !== 0x22) end++
  if (end === transcript.length) return invalid(`${name} is unterminated`)
  return { range: { start, end: end + 1 }, value: transcript.slice(valueStart, end) }
}

export function decodePrintable(value: Uint8Array, name: string, maximum: number): string {
  if (value.length === 0 || value.length > maximum) return invalid(`${name} length is invalid`)
  for (const byte of value)
    if (byte < 0x20 || byte > 0x7e) invalid(`${name} is not printable ASCII`)
  try {
    return decoder.decode(value)
  } catch {
    return invalid(`${name} is not ASCII`)
  }
}
