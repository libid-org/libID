import { parseJson, parseJsonNumbersAsText } from './json.js'
import type { Transcript, CommitmentOpening } from './notarization/session.js'
import type { ByteRange } from './notarization/notarize.js'
import { sha256 } from '@noble/hashes/sha2.js'
export function responseJson(transcript: Transcript, numbersAsText = false): unknown {
  const bytes = transcript.received,
    decoder = new TextDecoder('utf-8', { fatal: true }),
    text = decoder.decode(bytes),
    end = text.indexOf('\r\n\r\n')
  if (end < 0 || !/^HTTP\/1\.[01] 200(?: |\r)/.test(text))
    throw new Error('Platform request failed')
  const headerText = text.slice(0, end)
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
  const encoding = headers.get('content-encoding')
  if (encoding && encoding !== 'identity') throw new Error('Unsupported response encoding')
  const length = headers.get('content-length'),
    transfer = headers.get('transfer-encoding')
  let body = bytes.subarray(end + 4)
  if (transfer) {
    if (transfer.toLowerCase() !== 'chunked' || length !== undefined)
      throw new Error('Ambiguous HTTP framing')
    const chunks: Uint8Array[] = []
    let offset = 0,
      total = 0
    for (;;) {
      let lineEnd = offset
      while (lineEnd < body.length - 1 && (body[lineEnd] !== 13 || body[lineEnd + 1] !== 10))
        lineEnd++
      const sizeText = decoder.decode(body.subarray(offset, lineEnd))
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
    body = decoded
  } else if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) !== body.length))
    throw new Error('HTTP length mismatch')
  return (numbersAsText ? parseJsonNumbersAsText : parseJson)(decoder.decode(body))
}
export function bearerOpening(
  openings: readonly CommitmentOpening[],
  direction: 'sent' | 'received',
  range: ByteRange,
  bearer: string,
) {
  const matches = openings.filter(
    (o) => o.direction === direction && o.start === range.start && o.end === range.end,
  )
  if (matches.length !== 1) throw new Error('Bearer opening is not unique')
  const opening = matches[0],
    bytes = new TextEncoder().encode(bearer),
    preimage = new Uint8Array(bytes.length + 16)
  if (opening.blinder.length !== 16 || opening.end - opening.start !== bytes.length)
    throw new Error('Invalid bearer opening')
  preimage.set(bytes)
  preimage.set(opening.blinder, bytes.length)
  return { ...opening, hash: sha256(preimage) }
}
