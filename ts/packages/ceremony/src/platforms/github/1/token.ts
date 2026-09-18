import { isClientCredential, redirect } from '../../../ccdp/index.js'
import type { ExactHttpRequest, Transcript } from '../../../notary/session.js'
import { decodePrintable, quotedRange, tokenRequestBody } from '../../../notary/transcript.js'
import { bytesEqual } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'

const encoder = new TextEncoder()

export interface TokenRequestInput {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  clientCredential: string
}

function tokenBody(input: TokenRequestInput): Uint8Array {
  if (
    !isFormClientId(input.clientId) ||
    !/^[\x21-\x7e]{1,1024}$/.test(input.code) ||
    !redirect(input.redirectUri) ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.codeVerifier) ||
    !isClientCredential(input.clientCredential)
  )
    throw new Error('Invalid GitHub token request')
  return encoder.encode(
    new URLSearchParams([
      ['client_id', input.clientId],
      ['code', input.code],
      ['redirect_uri', input.redirectUri],
      ['code_verifier', input.codeVerifier],
      ['client_secret', input.clientCredential],
    ]).toString(),
  )
}

/** GitHub's public-client PKCE exchange, sent inside the browser's Proxy session. */
export function buildTokenRequest(input: TokenRequestInput): ExactHttpRequest {
  const body = tokenBody(input)
  return {
    url: 'https://github.com/login/oauth/access_token',
    method: 'POST',
    headers: {
      Host: encoder.encode('github.com'),
      'Content-Type': encoder.encode('application/x-www-form-urlencoded'),
      'Content-Length': encoder.encode(String(body.length)),
      Accept: encoder.encode('application/json'),
      Connection: encoder.encode('close'),
    },
    body,
  }
}

/** Reveal the whole canonical request and the response framing around its hidden bearer. */
export function selectToken(transcript: Transcript, input: TokenRequestInput) {
  const body = tokenRequestBody(
    transcript.sent,
    'POST /login/oauth/access_token HTTP/1.1',
    'github.com',
  )
  // Exact equality to the frozen tuple rejects duplicate/extra fields and noncanonical encoding.
  if (!bytesEqual(body, tokenBody(input))) throw new Error('GitHub token request changed')
  const token = quotedRange(transcript.received, 'access_token')
  // libid-circuits v0.3.0 bearer-link private-input width.
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
