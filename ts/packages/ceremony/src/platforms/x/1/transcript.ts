import { bytesEqual } from '../../../primitives.js'
import type { ByteRange, RevealRanges, Transcript } from '../../../prover/notarization/notarize.js'
import type { ExactHttpRequest } from '../../../prover/notarization/session.js'
import {
  decodePrintable,
  identityBearerRange,
  quotedRange,
  tokenRequestBody,
} from '../../../prover/transcript.js'
import { isUserId } from '../../types.js'
import { isUserName } from './types.js'

const encoder = new TextEncoder()
const TOKEN_LINE = 'POST /2/oauth2/token HTTP/1.1'
const IDENTITY_LINE = 'GET /2/users/me HTTP/1.1'
const USER_ID = encoder.encode('"id"')
const USERNAME = encoder.encode('"username"')
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
  const body = encoder.encode(tokenBody(input))
  return {
    url: 'https://api.x.com/2/oauth2/token',
    method: 'POST',
    // Concrete launch encoding qualified by the reclaimed-notary PoC. The
    // attested TLS server identity, not this prover-written Host field, is
    // the verifier's authority input.
    headers: {
      Host: ascii('api.x.com'),
      'Content-Type': ascii('application/x-www-form-urlencoded'),
      'Content-Length': ascii(String(body.length)),
      Accept: ascii('application/json'),
      Connection: ascii('close'),
    },
    body,
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
  const body = tokenRequestBody(transcript.sent, TOKEN_LINE, 'api.x.com')
  if (!bytesEqual(body, encoder.encode(tokenBody(input)))) {
    return invalid('token request body changed')
  }

  const accessToken = quotedRange(transcript.recv, 'access_token')
  const token = decodePrintable(accessToken.value, 'access token', MAX_BEARER_BYTES)
  const valueStart = accessToken.valueStart
  return {
    ranges: {
      sent: [{ start: 0, end: transcript.sent.length }],
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
      const field = quotedRange(reveal, 'id')
      if (field.range.end !== reveal.length) return invalid('identity id trailing bytes')
      const value = decodePrintable(field.value, 'identity id', 20)
      if (!isUserId(value)) return invalid('identity id is not canonical')
      userId = value
    } else if (
      bytesEqual(reveal.subarray(0, USERNAME.length), USERNAME) &&
      reveal.at(-1) === 0x22
    ) {
      if (handle !== null) return invalid('identity username reveal is duplicated')
      const field = quotedRange(reveal, 'username')
      if (field.range.end !== reveal.length) return invalid('identity username trailing bytes')
      const value = decodePrintable(field.value, 'identity username', 15)
      if (!isUserName(value)) return invalid('identity username is not canonical')
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
  const { start: bearerStart, end: bearerEnd } = identityBearerRange(
    transcript.sent,
    IDENTITY_LINE,
    expectedRequest.headers,
    accessToken,
  )

  const id = quotedRange(transcript.recv, 'id')
  const username = quotedRange(transcript.recv, 'username')
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
