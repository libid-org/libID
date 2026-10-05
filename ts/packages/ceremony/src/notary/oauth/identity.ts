// The attested identity request that spends the token's bearer (ceremony-common §9): its
// exact bytes, the hidden bearer, and the user ID and name its response reveals.
import { FORBIDDEN_REQUEST_HEADERS } from '@libid/contracts/ceremony'
import { latin1, parseHead } from '../http.js'
import type { ByteRange, ExactHttpRequest, Transcript } from '../protocol.js'
import {
  decodePrintable,
  invalidTranscript,
  numericRange,
  quotedRange,
  requestFieldName,
} from '../transcript.js'
import type { Bounded } from './validation.js'

const encoder = new TextEncoder()

// REQ-COMMON-39B, save the Authorization header that carries the bearer.
const FORBIDDEN_HEADERS = new Set(
  FORBIDDEN_REQUEST_HEADERS.filter((name) => name !== 'authorization'),
)

/**
 * A platform's fixed identity request and its user grammar. Raw transcript bytes remain the
 * authority for disclosure ranges.
 */
export interface IdentityLayout {
  url: string
  headers: Record<string, string>
  userId: Bounded & { field: string; quoted: boolean }
  userName: Bounded & { field: string }
  /** Cross-check the parsed response against the exact selected identity bytes. */
  isResponse(body: Record<string, unknown>, selected: { userId: string; userName: string }): boolean
}

export function identityRequest(layout: IdentityLayout) {
  const url = new URL(layout.url)
  function build(bearer: string): ExactHttpRequest {
    // The header carries the bearer verbatim, one byte per character.
    if (!/^[\x21-\x7e]+$/.test(bearer)) throw new Error('Invalid bearer')
    return {
      url: layout.url,
      method: 'GET',
      headers: Object.fromEntries(
        Object.entries({
          Host: url.host,
          Authorization: `Bearer ${bearer}`,
          ...layout.headers,
          Connection: 'close',
        }).map(([key, value]) => [key, encoder.encode(value)]),
      ),
      body: new Uint8Array(),
    }
  }

  /** Read exact ID bytes (including numeric IDs above JS precision), never a rounded JSON number. */
  function select(transcript: Transcript, bearer: string) {
    const bearerRange = identityBearerRange(
      transcript.sent,
      `GET ${url.pathname} HTTP/1.1`,
      build(bearer).headers,
      bearer,
    )
    const id = layout.userId.quoted
      ? quotedRange(transcript.received, layout.userId.field)
      : numericRange(transcript.received, layout.userId.field)
    const userId = decodePrintable(id.value, 'identity id', layout.userId.maxBytes)
    if (!layout.userId.valid(userId)) throw new Error('Invalid identity id')
    const name = quotedRange(transcript.received, layout.userName.field)
    const userName = decodePrintable(name.value, 'identity name', layout.userName.maxBytes)
    if (!layout.userName.valid(userName)) throw new Error('Invalid identity name')
    return {
      userId,
      userName,
      bearerRange,
      ranges: {
        sent: [
          { start: 0, end: bearerRange.start },
          { start: bearerRange.end, end: transcript.sent.length },
        ],
        received: [id.range, name.range].sort((a, b) => a.start - b.start),
      },
    }
  }

  return {
    url: layout.url,
    build,
    select,
    isResponse: layout.isResponse,
  }
}

export type IdentityRequest = ReturnType<typeof identityRequest>

/** Locate the sole bearer hole while admitting additional identity headers. */
function identityBearerRange(
  sent: Uint8Array,
  requestLine: string,
  required: Record<string, Uint8Array>,
  bearer: string,
): ByteRange {
  const head = parseHead(sent)
  if (!head || head.bodyStart !== sent.length) invalidTranscript('identity request framing')
  if (head.startLine !== requestLine) invalidTranscript('identity request line')
  // Latin-1 decoding matches the head's one code unit per wire byte, including UTF-8 values.
  const expected = new Map(
    Object.entries(required).map(([name, value]) => [name.toLowerCase(), latin1.decode(value)]),
  )
  const seen = new Set<string>()
  let start = -1
  for (const field of head.fields) {
    const name = requestFieldName(field.name, 'identity header framing')
    if (FORBIDDEN_HEADERS.has(name)) invalidTranscript('forbidden identity header')
    if (expected.has(name)) {
      if (seen.has(name) || field.value !== ` ${expected.get(name)}`)
        invalidTranscript('identity header value or duplicate')
      seen.add(name)
    }
    if (name === 'authorization') start = field.offset + field.name.length + ': Bearer '.length
  }
  if (seen.size !== expected.size || start < 0) invalidTranscript('missing identity header')
  return { start, end: start + bearer.length }
}
