// Exact HTTP/1.1 transcript bytes for notary and platform tests. The builders frame what they are
// given and normalize nothing, so a test can still spell out any malformed variant it rejects.
import { concatBytes } from '@noble/hashes/utils.js'
import type { ExactHttpRequest, Transcript } from '../notary/protocol.js'

type Bytes = string | Uint8Array

const encoder = new TextEncoder()

const bytes = (value: Bytes) => (typeof value === 'string' ? encoder.encode(value) : value)

/** A request fixture; unspecified parts default to a bodiless GET without headers. */
export const exactRequest = (
  url: string,
  request: Partial<Omit<ExactHttpRequest, 'url'>> = {},
): ExactHttpRequest => ({ url, method: 'GET', headers: {}, body: new Uint8Array(), ...request })

/** The start line, one `name: value` line per field in the given order, a blank line, then `body`. */
function httpRequest(
  line: string,
  fields: Iterable<readonly [string, Bytes]>,
  body: Bytes = '',
): Uint8Array {
  const head = Array.from(fields, ([name, value]) => [
    bytes(`${name}: `),
    bytes(value),
    bytes('\r\n'),
  ])
  return concatBytes(bytes(`${line}\r\n`), ...head.flat(), bytes('\r\n'), bytes(body))
}

/**
 * An ExactHttpRequest as the TLSN prover records it: hyper writes lowercase field names, and the
 * SDK's header map keeps no insertion order, so fields are reversed to keep selectors from relying
 * on the builder's order.
 */
export const proverRequest = (
  line: string,
  { headers, body }: Pick<ExactHttpRequest, 'headers' | 'body'>,
): Uint8Array =>
  httpRequest(
    line,
    Object.entries(headers)
      .reverse()
      .map(([name, value]) => [name.toLowerCase(), value] as const),
    body,
  )

/** `HTTP/1.1 <status>`, the complete CRLF-terminated field lines in `head`, a blank line, then `body`. */
export const httpResponse = (body: Bytes = '', head = '', status = '200 OK'): Uint8Array =>
  concatBytes(bytes(`HTTP/1.1 ${status}\r\n${head}\r\n`), bytes(body))

/** Chunked transfer coding of `chunks` and the final zero chunk; a chunk may split a character. */
export const chunked = (...chunks: Bytes[]): Uint8Array =>
  concatBytes(
    ...chunks.flatMap((chunk) => {
      const data = bytes(chunk)
      return [bytes(`${data.length.toString(16)}\r\n`), data, bytes('\r\n')]
    }),
    bytes('0\r\n\r\n'),
  )

/** A transcript whose sent direction is empty, for response-only parsing. */
export const receivedOnly = (received: Uint8Array): Transcript => ({
  sent: new Uint8Array(),
  received,
})
