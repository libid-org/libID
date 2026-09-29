import { FIELD_NAME, parseHead, trimField } from './http.js'
import type { ByteRange } from './protocol.js'

const decoder = new TextDecoder('utf-8', { fatal: true })

// REQ-COMMON-39B applies to both request types; tokens also forbid Authorization.
const FORBIDDEN_HEADERS = new Set([
  'cookie',
  'content-encoding',
  'transfer-encoding',
  'x-http-method-override',
  'x-http-method',
  'x-method-override',
])

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

function findUnique(haystack: Uint8Array, needle: Uint8Array, name: string): number {
  const start = findFrom(haystack, needle)
  if (start < 0) return invalid(`${name} is missing`)
  if (findFrom(haystack, needle, start + 1) >= 0) return invalid(`${name} is duplicated`)
  return start
}

/** JSON whitespace only; offsets always remain relative to the original bytes. */
export function skipJsonWhitespace(bytes: Uint8Array, start: number): number {
  while ([32, 9, 10, 13].includes(bytes[start])) start++
  return start
}

export function jsonField(
  transcript: Uint8Array,
  name: string,
): { start: number; valueStart: number } {
  const key = new TextEncoder().encode(`"${name}"`)
  let found: { start: number; valueStart: number } | undefined
  for (
    let start = findFrom(transcript, key);
    start >= 0;
    start = findFrom(transcript, key, start + 1)
  ) {
    const colon = skipJsonWhitespace(transcript, start + key.length)
    if (transcript[colon] !== 58) continue
    if (found) return invalid(`${name} is duplicated`)
    found = { start, valueStart: skipJsonWhitespace(transcript, colon + 1) }
  }
  return found ?? invalid(`${name} is missing`)
}

export function quotedRange(
  transcript: Uint8Array,
  name: string,
): { range: ByteRange; valueStart: number; value: Uint8Array } {
  const field = jsonField(transcript, name)
  if (transcript[field.valueStart] !== 34) return invalid(`${name} is not a string`)
  const valueStart = field.valueStart + 1
  let end = valueStart
  while (end < transcript.length && transcript[end] !== 0x22) end++
  if (end === transcript.length) return invalid(`${name} is unterminated`)
  return {
    range: { start: field.start, end: end + 1 },
    valueStart,
    value: transcript.slice(valueStart, end),
  }
}

export function decodePrintable(value: Uint8Array, name: string, maximum: number): string {
  if (value.length === 0 || value.length > maximum) return invalid(`${name} length is invalid`)
  for (const byte of value)
    if (byte < 0x20 || byte > 0x7e) invalid(`${name} is not printable ASCII`)
  return decoder.decode(value)
}

/** Case-fold a request field name, treating `_` as `-` for forbidden and required names. */
function requestName(name: string, reason: string): string {
  if (!FIELD_NAME.test(name)) invalid(reason)
  return name.toLowerCase().replaceAll('_', '-')
}

/** Read the fully disclosed request, with Content-Length bound to its complete body. */
export function tokenRequestBody(
  request: Uint8Array,
  requestLine: string,
  host: string,
): Uint8Array {
  findUnique(request, new Uint8Array([13, 10, 13, 10]), 'token head terminator')
  const head = parseHead(request) ?? invalid('token header framing')
  if (head.startLine !== requestLine) invalid('token request framing')
  const expected = new Map([
    ['host', host],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['content-length', String(request.length - head.bodyStart)],
  ])
  const seen = new Set<string>()
  for (const field of head.fields) {
    // Token requests tolerate whitespace before the colon; identity requests do not.
    const name = requestName(field.name.replace(/[ \t]+$/, ''), 'token header framing')
    if (name === 'authorization' || FORBIDDEN_HEADERS.has(name)) invalid('forbidden token header')
    if (expected.has(name)) {
      if (seen.has(name) || expected.get(name) !== trimField(field.value))
        invalid('token header value or duplicate')
      seen.add(name)
    }
  }
  if (seen.size !== expected.size) invalid('missing token header')
  return request.subarray(head.bodyStart)
}

/** Locate the sole bearer hole while admitting additional identity headers. */
export function identityBearerRange(
  sent: Uint8Array,
  requestLine: string,
  required: Record<string, Uint8Array>,
  bearer: string,
): ByteRange {
  const head = parseHead(sent)
  if (!head || head.bodyStart !== sent.length) invalid('identity request framing')
  if (head.startLine !== requestLine) invalid('identity request line')
  // Latin-1 decoding matches the head's one code unit per wire byte, including UTF-8 values.
  const latin1 = new TextDecoder('latin1')
  const expected = new Map(
    Object.entries(required).map(([name, value]) => [name.toLowerCase(), latin1.decode(value)]),
  )
  const seen = new Set<string>()
  let start = -1
  for (const field of head.fields) {
    const name = requestName(field.name, 'identity header framing')
    if (FORBIDDEN_HEADERS.has(name)) invalid('forbidden identity header')
    if (expected.has(name)) {
      if (seen.has(name) || field.value !== ` ${expected.get(name)}`)
        invalid('identity header value or duplicate')
      seen.add(name)
    }
    if (name === 'authorization') start = field.offset + field.name.length + ': Bearer '.length
  }
  if (seen.size !== expected.size || start < 0) invalid('missing identity header')
  return { start, end: start + bearer.length }
}
