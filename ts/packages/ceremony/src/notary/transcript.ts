import { latin1 } from './http.js'
import type { ByteRange } from './protocol.js'

// JSON permits only space, tab, LF and CR between tokens.
const JSON_WHITESPACE = [0x20, 0x09, 0x0a, 0x0d]
const JSON_COLON = 0x3a
const JSON_QUOTE = 0x22

const decoder = new TextDecoder('utf-8', { fatal: true })

/** Reject a transcript that breaks its layout; offsets never leave the original bytes. */
export function invalidTranscript(reason: string): never {
  throw new Error(`Invalid transcript: ${reason}`)
}

/** JSON whitespace only; offsets always remain relative to the original bytes. */
export function skipJsonWhitespace(bytes: Uint8Array, start: number): number {
  while (JSON_WHITESPACE.includes(bytes[start])) start++
  return start
}

/** Locate the sole ASCII `name` key followed by a colon; Latin-1 text offsets are byte offsets. */
export function jsonField(
  transcript: Uint8Array,
  name: string,
): { start: number; valueStart: number } {
  const text = latin1.decode(transcript)
  const key = `"${name}"`
  let found: { start: number; valueStart: number } | undefined
  for (let start = text.indexOf(key); start >= 0; start = text.indexOf(key, start + 1)) {
    const colon = skipJsonWhitespace(transcript, start + key.length)
    if (transcript[colon] !== JSON_COLON) continue
    if (found) return invalidTranscript(`${name} is duplicated`)
    found = { start, valueStart: skipJsonWhitespace(transcript, colon + 1) }
  }
  return found ?? invalidTranscript(`${name} is missing`)
}

export function quotedRange(
  transcript: Uint8Array,
  name: string,
): { range: ByteRange; valueStart: number; value: Uint8Array } {
  const field = jsonField(transcript, name)
  if (transcript[field.valueStart] !== JSON_QUOTE)
    return invalidTranscript(`${name} is not a string`)
  const valueStart = field.valueStart + 1
  const end = transcript.indexOf(JSON_QUOTE, valueStart)
  if (end < 0) return invalidTranscript(`${name} is unterminated`)
  return {
    range: { start: field.start, end: end + 1 },
    valueStart,
    value: transcript.slice(valueStart, end),
  }
}

export function decodePrintable(value: Uint8Array, name: string, maximum: number): string {
  if (value.length === 0 || value.length > maximum)
    return invalidTranscript(`${name} length is invalid`)
  for (const byte of value)
    if (byte < 0x20 || byte > 0x7e) invalidTranscript(`${name} is not printable ASCII`)
  return decoder.decode(value)
}
