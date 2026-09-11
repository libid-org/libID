import type { ByteRange } from './notarization/notarize.js'

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

export function findUnique(haystack: Uint8Array, needle: Uint8Array, name: string): number {
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
  try {
    return decoder.decode(value)
  } catch {
    return invalid(`${name} is not ASCII`)
  }
}

/** Read a fully disclosed token head; length includes any committed body suffix. */
export function tokenRequestBody(
  request: Uint8Array,
  requestLine: string,
  host: string,
  length = request.length,
): Uint8Array {
  const bodyStart =
    findUnique(request, new Uint8Array([13, 10, 13, 10]), 'token head terminator') + 4
  const head = request.subarray(0, bodyStart - 4)
  const [line, ...headers] = new TextDecoder('latin1').decode(head).split('\r\n')
  if (line !== requestLine || length < request.length) invalid('token request framing')
  const expected = new Map([
    ['host', host],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['content-length', String(length - bodyStart)],
  ])
  const seen = new Set<string>()
  for (const header of headers) {
    const match = /^([!#$%&'*+.^_`|~0-9a-z-]+)[ \t]*:([\t\x20-\x7e\u0080-\uffff]*)$/i.exec(header)
    if (!match) invalid('token header framing')
    const name = match[1].toLowerCase().replaceAll('_', '-')
    if (name === 'authorization' || FORBIDDEN_HEADERS.has(name)) invalid('forbidden token header')
    if (expected.has(name)) {
      const value = match[2].replace(/^[ \t]+|[ \t]+$/g, '')
      if (seen.has(name) || expected.get(name) !== value) invalid('token header value or duplicate')
      seen.add(name)
    }
  }
  if (seen.size !== expected.size) invalid('missing token header')
  return request.subarray(bodyStart)
}

/** Locate the sole bearer hole while admitting additional identity headers. */
export function identityBearerRange(
  sent: Uint8Array,
  requestLine: string,
  required: Record<string, Uint8Array>,
  bearer: string,
): ByteRange {
  // Latin-1 decoding produces one code unit per wire byte, including UTF-8 header values.
  const bytes = new TextDecoder('latin1')
  const text = bytes.decode(sent)
  const headEnd = text.indexOf('\r\n\r\n')
  if (headEnd < 0 || headEnd !== text.length - 4) invalid('identity request framing')
  const [line, ...headers] = text.slice(0, headEnd).split('\r\n')
  if (line !== requestLine) invalid('identity request line')
  const expected = new Map(
    Object.entries(required).map(([name, value]) => [name.toLowerCase(), bytes.decode(value)]),
  )
  const seen = new Set<string>()
  let offset = line.length + 2,
    start = -1
  for (const header of headers) {
    const match = /^([!#$%&'*+.^_`|~0-9a-z-]+):([\t\x20-\x7e\u0080-\uffff]*)$/i.exec(header)
    if (!match) invalid('identity header framing')
    const name = match[1].toLowerCase().replaceAll('_', '-')
    if (FORBIDDEN_HEADERS.has(name)) invalid('forbidden identity header')
    if (expected.has(name)) {
      if (seen.has(name) || match[2] !== ` ${expected.get(name)}`)
        invalid('identity header value or duplicate')
      seen.add(name)
    }
    if (name === 'authorization') start = offset + match[1].length + ': Bearer '.length
    offset += header.length + 2
  }
  if (seen.size !== expected.size || start < 0) invalid('missing identity header')
  return { start, end: start + bearer.length }
}
