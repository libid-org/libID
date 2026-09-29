import type { Transcript } from './protocol.js'

// Latin-1 keeps one code unit per wire byte, so string offsets are transcript offsets.
const latin1 = new TextDecoder('latin1')

/** Decode a successful HTTP response without altering the transcript used for commitments. */
export function responseJson(transcript: Transcript): unknown {
  const bytes = transcript.received,
    text = latin1.decode(bytes),
    end = text.indexOf('\r\n\r\n')
  if (end < 0 || !/^HTTP\/1\.[01] 200(?: |\r)/.test(text))
    throw new Error('Platform request failed')
  const headers = parseHeaders(text.slice(0, end))
  const encoding = headers.get('content-encoding')
  if (encoding && encoding !== 'identity') throw new Error('Unsupported response encoding')
  const length = headers.get('content-length'),
    transfer = headers.get('transfer-encoding')
  let body = bytes.subarray(end + 4)
  if (transfer) {
    if (transfer.toLowerCase() !== 'chunked' || length !== undefined)
      throw new Error('Ambiguous HTTP framing')
    body = decodeChunked(body)
  } else if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) !== body.length))
    throw new Error('HTTP length mismatch')
  // Only the de-framed body is UTF-8; chunk boundaries may split a character.
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
}

/** Framing headers are ASCII-only. */
function parseHeaders(headerText: string): Map<string, string> {
  if (/[^\t\x20-\x7e\r\n]/.test(headerText)) throw new Error('Invalid HTTP headers')
  const headers = new Map<string, string>()
  for (const line of headerText.split('\r\n').slice(1)) {
    const i = line.indexOf(':')
    if (i <= 0) throw new Error('Invalid HTTP header')
    const name = line.slice(0, i).toLowerCase()
    if (
      headers.has(name) &&
      ['content-length', 'transfer-encoding', 'content-encoding'].includes(name)
    )
      throw new Error('Duplicate framing header')
    headers.set(name, line.slice(i + 1).trim())
  }
  return headers
}

/** Decode a complete chunked body; extensions and trailers are rejected. */
function decodeChunked(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0,
    total = 0
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
    total += size
    offset += size + 2
  }
  const decoded = new Uint8Array(total)
  offset = 0
  for (const chunk of chunks) {
    decoded.set(chunk, offset)
    offset += chunk.length
  }
  return decoded
}
