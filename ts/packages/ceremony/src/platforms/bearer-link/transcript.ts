import type { ExactHttpRequest, Transcript } from '../../notary/protocol.js'
import {
  decodePrintable,
  identityBearerRange,
  jsonField,
  quotedRange,
  skipJsonWhitespace,
  tokenRequestBody,
} from '../../notary/transcript.js'
import { bytesEqual } from '../../primitives.js'
import { isUserId } from '../types.js'

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}

const encoder = new TextEncoder()

/** Fixed platform layout; raw transcript bytes remain the authority for disclosure ranges. */
export function bearerTranscript<Input>(profile: {
  tokenUrl: string
  tokenFields(input: Input): [string, string][]
  identityUrl: string
  identityHeaders: Record<string, string>
  quotedId: boolean
  userName: { field: string; maxBytes: number; valid(value: string): boolean }
}) {
  const tokenUrl = new URL(profile.tokenUrl)
  const identityUrl = new URL(profile.identityUrl)
  const tokenBody = (input: Input) =>
    encoder.encode(new URLSearchParams(profile.tokenFields(input)).toString())

  function buildTokenRequest(input: Input): ExactHttpRequest {
    const body = tokenBody(input)
    return {
      url: profile.tokenUrl,
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
    // libid-circuits v0.4.0 bearer-link private-input width; HTTP bearers contain no whitespace.
    if (!/^[\x21-\x7e]{1,128}$/.test(bearer)) throw new Error('Invalid bearer')
    return {
      url: profile.identityUrl,
      method: 'GET',
      headers: Object.fromEntries(
        Object.entries({
          Host: identityUrl.host,
          Authorization: `Bearer ${bearer}`,
          ...profile.identityHeaders,
          Connection: 'close',
        }).map(([key, value]) => [key, encoder.encode(value)]),
      ),
      body: new Uint8Array(),
    }
  }

  /** Reveal the canonical frozen request and response framing around the hidden bearer. */
  function selectToken(transcript: Transcript, input: Input) {
    const body = tokenRequestBody(
      transcript.sent,
      `POST ${tokenUrl.pathname} HTTP/1.1`,
      tokenUrl.host,
    )
    if (!bytesEqual(body, tokenBody(input))) throw new Error('Token request body changed')
    const token = quotedRange(transcript.received, 'access_token')
    const accessToken = decodePrintable(token.value, 'access token', 128)
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
    const id = profile.quotedId
      ? quotedRange(transcript.received, 'id')
      : numericId(transcript.received)
    const userId = decodePrintable(id.value, 'identity id', 20)
    if (!isUserId(userId)) throw new Error('Invalid identity id')
    const name = quotedRange(transcript.received, profile.userName.field)
    const userName = decodePrintable(name.value, 'identity name', profile.userName.maxBytes)
    if (!profile.userName.valid(userName)) throw new Error('Invalid identity name')
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
    identityUrl: profile.identityUrl,
    buildTokenRequest,
    buildIdentityRequest,
    selectToken,
    selectIdentity,
  }
}

function numericId(bytes: Uint8Array) {
  const { start, valueStart } = jsonField(bytes, 'id')
  let end = valueStart
  while (bytes[end] >= 48 && bytes[end] <= 57) end++
  const value = bytes.subarray(valueStart, end)
  end = skipJsonWhitespace(bytes, end)
  if (![44, 125].includes(bytes[end])) throw new Error('Invalid identity id terminator')
  return { value, range: { start, end: end + 1 } }
}
