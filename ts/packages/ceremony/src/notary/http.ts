import { concatBytes } from '@noble/hashes/utils.js'
import type { Transcript } from './protocol.js'

// Latin-1 keeps one code unit per wire byte, so string offsets are transcript offsets.
const latin1 = new TextDecoder('latin1')

/** RFC 9110 field-name token. */
export const FIELD_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i

/** One raw field line: `name` precedes its first colon; neither part is trimmed or folded. */
interface HeadField {
  name: string
  value: string
  /** Transcript offset of the field line. */
  offset: number
}

/** Offset of the first CRLFCRLF head terminator, or -1. */
function headEnd(bytes: Uint8Array): number {
  return latin1.decode(bytes).indexOf('\r\n\r\n')
}

/**
 * Tokenize an HTTP/1.1 head at its first CRLFCRLF into exact CRLF lines. Undefined unless
 * every line is field text (no bare CR/LF or other controls) and every field line has a
 * colon. Callers own name, whitespace, value and duplicate policy.
 */
export function parseHead(
  bytes: Uint8Array,
): { startLine: string; fields: HeadField[]; bodyStart: number } | undefined {
  const end = headEnd(bytes)
  if (end < 0) return
  const [startLine, ...lines] = latin1.decode(bytes.subarray(0, end)).split('\r\n')
  if (!fieldText(startLine)) return
  const fields: HeadField[] = []
  let offset = startLine.length + 2
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0 || !fieldText(line)) return
    fields.push({ name: line.slice(0, colon), value: line.slice(colon + 1), offset })
    offset += line.length + 2
  }
  return { startLine, fields, bodyStart: end + 4 }
}

/** Tab, visible ASCII, space and obs-text; Latin-1 maps bytes 0x80-0xff above U+007F. */
const fieldText = (line: string) => /^[\t\x20-\x7e\u0080-\uffff]*$/.test(line)

/** Strip optional HTTP whitespace around a field value. */
export const trimField = (value: string) => value.replace(/^[ \t]+|[ \t]+$/g, '')

/** Raw wire sizes: headers include status and separator; the body includes any chunk framing. */
export function responseSizes(received: Uint8Array): Record<string, number> {
  const end = headEnd(received)
  return end < 0
    ? {}
    : { 'response-header-bytes': end + 4, 'response-body-bytes': received.length - end - 4 }
}

/** Decode a successful HTTP response without altering the transcript used for commitments. */
export function responseJson(transcript: Transcript): unknown {
  const head = parseHead(transcript.received)
  if (!head) throw new Error('Invalid HTTP response')
  if (!/^HTTP\/1\.[01] 200(?: |$)/.test(head.startLine)) throw new Error('Platform request failed')
  const headers = framingHeaders(head.fields)
  const encoding = headers.get('content-encoding')
  if (encoding && encoding !== 'identity') throw new Error('Unsupported response encoding')
  const length = headers.get('content-length'),
    transfer = headers.get('transfer-encoding')
  let body = transcript.received.subarray(head.bodyStart)
  if (transfer) {
    if (transfer.toLowerCase() !== 'chunked' || length !== undefined)
      throw new Error('Ambiguous HTTP framing')
    body = decodeChunked(body)
  } else if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) !== body.length))
    throw new Error('HTTP length mismatch')
  // Only the de-framed body is UTF-8; chunk boundaries may split a character.
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
}

/** Case-folded response fields; framing headers must not repeat. */
function framingHeaders(fields: readonly HeadField[]): Map<string, string> {
  const headers = new Map<string, string>()
  for (const field of fields) {
    if (!FIELD_NAME.test(field.name)) throw new Error('Invalid HTTP header')
    const name = field.name.toLowerCase()
    if (
      headers.has(name) &&
      ['content-length', 'transfer-encoding', 'content-encoding'].includes(name)
    )
      throw new Error('Duplicate framing header')
    headers.set(name, trimField(field.value))
  }
  return headers
}

/** Decode a complete chunked body; extensions and trailers are rejected. */
function decodeChunked(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  for (;;) {
    let lineEnd = offset
    while (lineEnd < body.length - 1 && (body[lineEnd] !== 13 || body[lineEnd + 1] !== 10))
      lineEnd++
    const sizeText = latin1.decode(body.subarray(offset, lineEnd))
    if (!/^[0-9a-fA-F]{1,8}$/.test(sizeText)) throw new Error('Invalid chunk size')
    const size = Number.parseInt(sizeText, 16)
    offset = lineEnd + 2
    if (size === 0) {
      if (offset + 2 !== body.length || body[offset] !== 13 || body[offset + 1] !== 10)
        throw new Error('Invalid final chunk')
      break
    }
    if (
      offset + size + 2 > body.length ||
      body[offset + size] !== 13 ||
      body[offset + size + 1] !== 10
    )
      throw new Error('Truncated chunk')
    chunks.push(body.subarray(offset, offset + size))
    offset += size + 2
  }
  return concatBytes(...chunks)
}
