import { parseJson } from '../json.js'
import type { Transcript } from './session.js'
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

/** Preserve numeric root fields as bigint, without ever rounding an identity ID. */
function parseJsonNumbersAsText(source: string): unknown {
  const numericRoots = new Map<string, string>()
  let depth = 0
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]]/g)) {
    const token = match[0]
    if (token === '{' || token === '[') depth++
    else if (token === '}' || token === ']') depth--
    else if (depth === 1) {
      const number = /^\s*:\s*(-?(?:0|[1-9][0-9]*))\s*[,}]/.exec(
        source.slice(match.index + token.length),
      )
      if (number) numericRoots.set(JSON.parse(token), number[1])
    }
  }
  const value = parseJson(
    source.replace(
      /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g,
      (token, offset) => {
        if (token.startsWith('"')) return token
        if (/^\s*:/.test(source.slice(offset + token.length)))
          throw new TypeError('Invalid JSON object key')
        return JSON.stringify(token)
      },
    ),
  )
  if (value && typeof value === 'object' && !Array.isArray(value))
    for (const [key, number] of numericRoots)
      Object.defineProperty(value, key, {
        value: BigInt(number),
        enumerable: true,
        writable: true,
        configurable: true,
      })
  return value
}
