// The attested token request (ceremony-common §9): its exact bytes, and the bearer its
// response reveals the framing of and hides.
import { FORBIDDEN_REQUEST_HEADERS } from '@libid/contracts/ceremony'
import { latin1, parseHead, trimField } from '../http.js'
import { bytesEqual } from '../notarize.js'
import type { ExactHttpRequest, Transcript } from '../protocol.js'
import { decodePrintable, invalidTranscript, quotedRange, requestFieldName } from '../transcript.js'
import { type Bounded, isAuthorizationCode, isFormClientId } from './validation.js'

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  clientCredential?: string
}

const encoder = new TextEncoder()

// REQ-COMMON-39B, Authorization included: the token request authenticates in its form.
const FORBIDDEN_HEADERS = new Set(FORBIDDEN_REQUEST_HEADERS)

/** A platform's fixed token request and the rules it adds: which inputs, and which bearer. */
export interface TokenLayout {
  url: string
  fields(input: TokenRequestInput): [string, string][]
  /** Admission of the inputs beyond the form's own rules, checked before any request is built. */
  acceptsInput(input: TokenRequestInput): boolean
  bearer: Bounded
}

export function tokenRequest(layout: TokenLayout) {
  const url = new URL(layout.url)
  function body(input: TokenRequestInput) {
    if (
      !isFormClientId(input.clientId) ||
      !isAuthorizationCode(input.code) ||
      !layout.acceptsInput(input)
    )
      throw new Error('Invalid token request')
    return encoder.encode(new URLSearchParams(layout.fields(input)).toString())
  }

  function build(input: TokenRequestInput): ExactHttpRequest {
    const sent = body(input)
    return {
      url: layout.url,
      method: 'POST',
      // The attested TLS server identity, not this prover-written Host field, is the authority.
      headers: {
        Host: encoder.encode(url.host),
        'Content-Type': encoder.encode(FORM_CONTENT_TYPE),
        'Content-Length': encoder.encode(String(sent.length)),
        Accept: encoder.encode('application/json'),
        Connection: encoder.encode('close'),
      },
      body: sent,
    }
  }

  /** Reveal the canonical frozen request and response framing around the hidden bearer. */
  function select(transcript: Transcript, input: TokenRequestInput) {
    const sentBody = tokenRequestBody(transcript.sent, `POST ${url.pathname} HTTP/1.1`, url.host)
    if (!bytesEqual(sentBody, body(input))) throw new Error('Token request body changed')
    const token = quotedRange(transcript.received, 'access_token')
    const bearer = decodePrintable(token.value, 'access token', layout.bearer.maxBytes)
    if (!layout.bearer.valid(bearer)) throw new Error('Invalid access token')
    return {
      bearer,
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

  return { url: layout.url, build, select }
}

export type TokenRequest = ReturnType<typeof tokenRequest>

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
    ['content-type', FORM_CONTENT_TYPE],
    ['content-length', String(request.length - head.bodyStart)],
  ])
  const seen = new Set<string>()
  for (const field of head.fields) {
    // Token requests tolerate whitespace before the colon; identity requests do not.
    const name = requestFieldName(field.name.replace(/[ \t]+$/, ''), 'token header framing')
    if (FORBIDDEN_HEADERS.has(name)) invalidTranscript('forbidden token header')
    if (expected.has(name)) {
      if (seen.has(name) || expected.get(name) !== trimField(field.value))
        invalidTranscript('token header value or duplicate')
      seen.add(name)
    }
  }
  if (seen.size !== expected.size) invalidTranscript('missing token header')
  return request.subarray(head.bodyStart)
}
