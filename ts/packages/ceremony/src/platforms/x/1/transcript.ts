import { findUnique, quotedRange, decodePrintable } from '../../../prover/transcript.js'
import { bytesEqual } from '../../../primitives.js'
import type { ByteRange, RevealRanges, Transcript } from '../../../prover/notarization/notarize.js'
import type { ExactHttpRequest } from '../../../prover/notarization/session.js'
const isXUserId = (value: string) =>
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn
const isXHandle = (value: string) => /^[A-Za-z0-9_]{1,15}$/.test(value)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const TOKEN_LINE = encoder.encode('POST /2/oauth2/token HTTP/1.1\r\n')
const IDENTITY_LINE = 'GET /2/users/me HTTP/1.1'
const AUTHORIZATION_PREFIX = 'authorization: Bearer '
const ACCESS_TOKEN = encoder.encode('"access_token":"')
const USER_ID = encoder.encode('"id":"')
const USERNAME = encoder.encode('"username":"')
// libid-circuits v0.3.0 bearer-link private-input width.
const MAX_BEARER_BYTES = 128
const PKCE = /^[A-Za-z0-9_-]{43}$/

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}

export interface TokenRevealSelection {
  ranges: RevealRanges
  accessToken: string
  bearerRange: ByteRange
}

function invalid(reason: string): never {
  throw new Error(`invalid X v1 transcript: ${reason}`)
}

function ascii(value: string): Uint8Array {
  return encoder.encode(value)
}

function tokenBody(input: TokenRequestInput): string {
  if (!PKCE.test(input.codeVerifier)) {
    throw new Error('codeVerifier must be exactly 43 base64url characters')
  }
  if (!input.clientId || !input.code || !input.redirectUri) {
    throw new Error('X token request fields must be nonempty')
  }
  return new URLSearchParams([
    ['grant_type', 'authorization_code'],
    ['client_id', input.clientId],
    ['code', input.code],
    ['redirect_uri', input.redirectUri],
    ['code_verifier', input.codeVerifier],
  ]).toString()
}

export function buildTokenRequest(input: TokenRequestInput): ExactHttpRequest {
  return {
    url: 'https://api.x.com/2/oauth2/token',
    method: 'POST',
    // Concrete launch encoding qualified by the reclaimed-notary PoC. The
    // attested TLS server identity, not this prover-written Host field, is
    // the verifier's authority input.
    headers: {
      Host: ascii('api.x.com'),
      'Content-Type': ascii('application/x-www-form-urlencoded'),
      Accept: ascii('application/json'),
      Connection: ascii('close'),
    },
    body: encoder.encode(tokenBody(input)),
  }
}

export function buildIdentityRequest(accessToken: string): ExactHttpRequest {
  const bearer = encoder.encode(accessToken)
  decodePrintable(bearer, 'access token', MAX_BEARER_BYTES)
  return {
    url: 'https://api.x.com/2/users/me',
    method: 'GET',
    headers: {
      Authorization: ascii(`Bearer ${accessToken}`),
      Accept: ascii('application/json'),
      Host: ascii('api.x.com'),
      Connection: ascii('close'),
    },
    body: new Uint8Array(),
  }
}

/** Select X's token request fields and bearer framing from one raw transcript. */
export function selectTokenReveals(
  transcript: Transcript,
  input: TokenRequestInput,
): TokenRevealSelection {
  if (!bytesEqual(transcript.sent.subarray(0, TOKEN_LINE.length), TOKEN_LINE)) {
    return invalid('token request line changed')
  }
  const separator = encoder.encode('\r\n\r\n')
  const bodyStart =
    findUnique(transcript.sent, separator, 'token header terminator') + separator.length
  const body = encoder.encode(tokenBody(input))
  if (!bytesEqual(transcript.sent.subarray(bodyStart), body)) {
    return invalid('token request body changed')
  }
  const bodyRanges: ByteRange[] = []
  let fieldStart = bodyStart
  for (let offset = 0; offset < body.length; offset++) {
    if (body[offset] !== 0x26) continue
    bodyRanges.push({ start: fieldStart, end: bodyStart + offset + 1 })
    fieldStart = bodyStart + offset + 1
  }
  bodyRanges.push({ start: fieldStart, end: transcript.sent.length })

  const accessToken = quotedRange(transcript.recv, ACCESS_TOKEN, 'access_token')
  const token = decodePrintable(accessToken.value, 'access token', MAX_BEARER_BYTES)
  const valueStart = accessToken.range.start + ACCESS_TOKEN.length
  return {
    ranges: {
      sent: [{ start: 0, end: TOKEN_LINE.length }, ...bodyRanges],
      recv: [
        { start: accessToken.range.start, end: valueStart },
        { start: accessToken.range.end - 1, end: accessToken.range.end },
      ],
    },
    accessToken: token,
    bearerRange: { start: valueStart, end: accessToken.range.end - 1 },
  }
}

export function identityFromReveals(reveals: readonly Uint8Array[]): {
  userId: string
  handle: string
} {
  let userId: string | null = null
  let handle: string | null = null
  for (const reveal of reveals) {
    if (bytesEqual(reveal.subarray(0, USER_ID.length), USER_ID) && reveal.at(-1) === 0x22) {
      if (userId !== null) return invalid('identity id reveal is duplicated')
      const value = decodePrintable(reveal.subarray(USER_ID.length, -1), 'identity id', 20)
      if (!isXUserId(value)) return invalid('identity id is not canonical')
      userId = value
    } else if (
      bytesEqual(reveal.subarray(0, USERNAME.length), USERNAME) &&
      reveal.at(-1) === 0x22
    ) {
      if (handle !== null) return invalid('identity username reveal is duplicated')
      const value = decodePrintable(reveal.subarray(USERNAME.length, -1), 'identity username', 15)
      if (!isXHandle(value)) return invalid('identity username is not canonical')
      handle = value
    } else {
      return invalid('identity response contains an unexpected reveal')
    }
  }
  if (userId === null || handle === null) return invalid('identity fields are missing')
  return { userId, handle }
}

/** Reveal the complete fixed identity request except its bearer and the two identity fields. */
export function selectIdentityReveals(transcript: Transcript, accessToken: string): RevealRanges {
  const expectedRequest = buildIdentityRequest(accessToken)
  let request: string
  try {
    request = decoder.decode(transcript.sent)
  } catch {
    return invalid('identity request is not ASCII')
  }
  const headerEnd = request.indexOf('\r\n\r\n')
  if (headerEnd < 0 || headerEnd !== request.length - 4) {
    return invalid('identity request framing changed')
  }
  const [requestLine, ...headers] = request.slice(0, headerEnd).split('\r\n')
  if (requestLine !== IDENTITY_LINE) return invalid('identity request line changed')

  const expectedHeaders = new Map(
    Object.entries(expectedRequest.headers).map(([name, value]) => [
      name.toLowerCase(),
      decoder.decode(value),
    ]),
  )
  let offset = IDENTITY_LINE.length + 2
  let bearerStart = -1
  for (const header of headers) {
    const separator = header.indexOf(': ')
    const name = separator < 0 ? '' : header.slice(0, separator).toLowerCase()
    const value = separator < 0 ? '' : header.slice(separator + 2)
    const expected = expectedHeaders.get(name)
    if (expected === undefined) return invalid('identity request has an unexpected header')
    if (value !== expected) return invalid(`identity request ${name} changed`)
    expectedHeaders.delete(name)
    if (name === 'authorization') bearerStart = offset + AUTHORIZATION_PREFIX.length
    offset += header.length + 2
  }
  if (expectedHeaders.size !== 0 || bearerStart < 0) {
    return invalid('identity request is missing a required header')
  }
  const bearerEnd = bearerStart + accessToken.length

  const id = quotedRange(transcript.recv, USER_ID, 'identity id')
  const username = quotedRange(transcript.recv, USERNAME, 'identity username')
  const response = [id.range, username.range].sort((a, b) => a.start - b.start)
  identityFromReveals(response.map((range) => transcript.recv.slice(range.start, range.end)))
  return {
    sent: [
      { start: 0, end: bearerStart },
      { start: bearerEnd, end: transcript.sent.length },
    ],
    recv: response,
  }
}
