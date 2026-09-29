import { isBearer } from '../barretenberg/circuits/bearer_link/inputs.js'
import { MAX_BEARER_BYTES } from '../barretenberg/circuits/bearer_link/parameters.js'
import { redirect } from '../ccdp/index.js'
import type { ExactHttpRequest, Transcript } from '../notary/protocol.js'
import {
  decodePrintable,
  identityBearerRange,
  jsonField,
  quotedRange,
  skipJsonWhitespace,
  tokenRequestBody,
} from '../notary/transcript.js'
import { bytesEqual } from '../primitives.js'
import { isFormClientId, isPkceValue } from './authorization.js'
import { isUserId, MAX_USER_ID_CHARS } from './types.js'

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  clientCredential?: string
}

const encoder = new TextEncoder()

// A consumed redirect code that fits one header-free form field of the bounded sent transcript.
const MAX_CODE_CHARS = 1024
const CODE = /^[\x21-\x7e]+$/

/** Fixed platform layout; raw transcript bytes remain the authority for disclosure ranges. */
export function bearerTranscript(profile: {
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
  const tokenUrl = new URL(profile.tokenUrl)
  const identityUrl = new URL(profile.identityUrl)
  function tokenBody(input: TokenRequestInput) {
    if (
      !isFormClientId(input.clientId) ||
      input.code.length > MAX_CODE_CHARS ||
      !CODE.test(input.code) ||
      !redirect(input.redirectUri) ||
      !isPkceValue(input.codeVerifier)
    )
      throw new Error('Invalid token request')
    return encoder.encode(new URLSearchParams(profile.tokenFields(input)).toString())
  }

  function buildTokenRequest(input: TokenRequestInput): ExactHttpRequest {
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
    if (!isBearer(bearer)) throw new Error('Invalid bearer')
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
    const id = profile.quotedId
      ? quotedRange(transcript.received, profile.idField)
      : numericId(transcript.received, profile.idField)
    const userId = decodePrintable(id.value, 'identity id', MAX_USER_ID_CHARS)
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
    identityResponse: profile.identityResponse,
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
