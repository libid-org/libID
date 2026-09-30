import { FORBIDDEN_REQUEST_HEADERS } from '@libid/contracts/ceremony'
import { isRedirectUri } from '../../../ccdp/index.js'
import { FIELD_NAME, latin1, parseHead, trimField } from '../../../notary/http.js'
import type { ByteRange, ExactHttpRequest, Transcript } from '../../../notary/protocol.js'
import {
  decodePrintable,
  invalidTranscript,
  jsonField,
  quotedRange,
  skipJsonWhitespace,
} from '../../../notary/transcript.js'
import { isFormClientId, isPkceValue } from '../../../platforms/authorization.js'
import { bytesEqual } from '../../../primitives.js'
import { isBearer } from './inputs.js'
import { MAX_BEARER_BYTES } from './parameters.js'
import { isUserId, MAX_USER_ID_CHARS } from './types.js'

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  clientCredential?: string
}

const encoder = new TextEncoder()

// REQ-COMMON-39B applies to both request types; tokens also forbid Authorization.
const FORBIDDEN_HEADERS = new Set(
  FORBIDDEN_REQUEST_HEADERS.filter((name) => name !== 'authorization'),
)

// A consumed redirect code that fits one header-free form field of the bounded sent transcript.
const MAX_CODE_CHARS = 1024
const CODE = /^[\x21-\x7e]+$/

/** Fixed platform layout; raw transcript bytes remain the authority for disclosure ranges. */
export function bearerTranscript(layout: {
  tokenUrl: string
  tokenFields(input: TokenRequestInput): [string, string][]
  identityUrl: string
  identityHeaders: Record<string, string>
  idField: string
  quotedId: boolean
  userName: { field: string; maxBytes: number; valid(value: string): boolean }
  /** Cross-check the parsed response against the exact selected identity bytes. */
  identityResponse(
    body: Record<string, unknown>,
    selected: { userId: string; userName: string },
  ): boolean
}) {
  const tokenUrl = new URL(layout.tokenUrl)
  const identityUrl = new URL(layout.identityUrl)
  function tokenBody(input: TokenRequestInput) {
    if (
      !isFormClientId(input.clientId) ||
      input.code.length > MAX_CODE_CHARS ||
      !CODE.test(input.code) ||
      !isRedirectUri(input.redirectUri) ||
      !isPkceValue(input.codeVerifier)
    )
      throw new Error('Invalid token request')
    return encoder.encode(new URLSearchParams(layout.tokenFields(input)).toString())
  }

  function buildTokenRequest(input: TokenRequestInput): ExactHttpRequest {
    const body = tokenBody(input)
    return {
      url: layout.tokenUrl,
      method: 'POST',
      // The attested TLS server identity, not this prover-written Host field, is the authority.
      headers: {
        Host: encoder.encode(tokenUrl.host),
        'Content-Type': encoder.encode('application/x-www-form-urlencoded'),
        'Content-Length': encoder.encode(String(body.length)),
        Accept: encoder.encode('application/json'),
        Connection: encoder.encode('close'),
      },
      body,
    }
  }

  function buildIdentityRequest(bearer: string): ExactHttpRequest {
    if (!isBearer(bearer)) throw new Error('Invalid bearer')
    return {
      url: layout.identityUrl,
      method: 'GET',
      headers: Object.fromEntries(
        Object.entries({
          Host: identityUrl.host,
          Authorization: `Bearer ${bearer}`,
          ...layout.identityHeaders,
          Connection: 'close',
        }).map(([key, value]) => [key, encoder.encode(value)]),
      ),
      body: new Uint8Array(),
    }
  }

  /** Reveal the canonical frozen request and response framing around the hidden bearer. */
  function selectToken(transcript: Transcript, input: TokenRequestInput) {
    const body = tokenRequestBody(
      transcript.sent,
      `POST ${tokenUrl.pathname} HTTP/1.1`,
      tokenUrl.host,
    )
    if (!bytesEqual(body, tokenBody(input))) throw new Error('Token request body changed')
    const token = quotedRange(transcript.received, 'access_token')
    const accessToken = decodePrintable(token.value, 'access token', MAX_BEARER_BYTES)
    if (!isBearer(accessToken)) throw new Error('Invalid access token')
    return {
      accessToken,
      bearerRange: { start: token.valueStart, end: token.range.end - 1 },
      ranges: {
        sent: [{ start: 0, end: transcript.sent.length }],
        received: [
          { start: token.range.start, end: token.valueStart },
          { start: token.range.end - 1, end: token.range.end },
        ],
      },
    }
  }

  /** Read exact ID bytes (including numeric IDs above JS precision), never a rounded JSON number. */
  function selectIdentity(transcript: Transcript, bearer: string) {
    const bearerRange = identityBearerRange(
      transcript.sent,
      `GET ${identityUrl.pathname} HTTP/1.1`,
      buildIdentityRequest(bearer).headers,
      bearer,
    )
    const id = layout.quotedId
      ? quotedRange(transcript.received, layout.idField)
      : numericId(transcript.received, layout.idField)
    const userId = decodePrintable(id.value, 'identity id', MAX_USER_ID_CHARS)
    if (!isUserId(userId)) throw new Error('Invalid identity id')
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
    identityUrl: layout.identityUrl,
    buildTokenRequest,
    buildIdentityRequest,
    selectToken,
    selectIdentity,
    identityResponse: layout.identityResponse,
  }
}

export type BearerTranscript = ReturnType<typeof bearerTranscript>

function numericId(bytes: Uint8Array, field: string) {
  const { start, valueStart } = jsonField(bytes, field)
  let end = valueStart
  // ASCII digits, followed only by JSON whitespace and a comma or closing brace.
  while (bytes[end] >= 0x30 && bytes[end] <= 0x39) end++
  const value = bytes.subarray(valueStart, end)
  end = skipJsonWhitespace(bytes, end)
  if (![0x2c, 0x7d].includes(bytes[end])) throw new Error('Invalid identity id terminator')
  return { value, range: { start, end: end + 1 } }
}

/** Case-fold a request field name, treating `_` as `-` for forbidden and required names. */
function requestName(name: string, reason: string): string {
  if (!FIELD_NAME.test(name)) invalidTranscript(reason)
  return name.toLowerCase().replaceAll('_', '-')
}

/** Read the fully disclosed request, with Content-Length bound to its complete body. */
function tokenRequestBody(request: Uint8Array, requestLine: string, host: string): Uint8Array {
  const text = latin1.decode(request)
  const terminator = text.indexOf('\r\n\r\n')
  if (terminator < 0) invalidTranscript('token head terminator is missing')
  if (text.includes('\r\n\r\n', terminator + 1))
    invalidTranscript('token head terminator is duplicated')
  const head = parseHead(request) ?? invalidTranscript('token header framing')
  if (head.startLine !== requestLine) invalidTranscript('token request framing')
  const expected = new Map([
    ['host', host],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['content-length', String(request.length - head.bodyStart)],
  ])
  const seen = new Set<string>()
  for (const field of head.fields) {
    // Token requests tolerate whitespace before the colon; identity requests do not.
    const name = requestName(field.name.replace(/[ \t]+$/, ''), 'token header framing')
    if (name === 'authorization' || FORBIDDEN_HEADERS.has(name))
      invalidTranscript('forbidden token header')
    if (expected.has(name)) {
      if (seen.has(name) || expected.get(name) !== trimField(field.value))
        invalidTranscript('token header value or duplicate')
      seen.add(name)
    }
  }
  if (seen.size !== expected.size) invalidTranscript('missing token header')
  return request.subarray(head.bodyStart)
}

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
    const name = requestName(field.name, 'identity header framing')
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
