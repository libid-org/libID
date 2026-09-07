import { origin } from '../../../ccdp/index.js'
import { parseJson } from '../../../prover/json.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { b64urlDecode, bytesEqual, hasExactKeys, isRecord } from '../../../primitives.js'
import {
  type DecodedAttestedData,
  type DecodedRangeCommitment,
  decodeAttestedData,
} from '../../../prover/notarization/decode.js'
import type { CorrelatedCommitment } from '../../../prover/notarization/notarize.js'
import type { NotaryAttestation } from '../../../prover/notarization/transport.js'

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024
const MAX_ATTESTED_DATA_BYTES = 2 * 1024 * 1024
const CODE = /^[\x21-\x7e]{1,1024}$/
const ACCESS_TOKEN = /^[\x21-\x7e]{1,128}$/
const CODE_VERIFIER = /^[A-Za-z0-9_-]{43}$/
const encoder = new TextEncoder()
const REQUEST_LINE = encoder.encode('POST /login/oauth/access_token HTTP/1.1\r\n')
const ACCESS_TOKEN_DELIMITER = encoder.encode('"access_token":"')
const QUOTE = new Uint8Array([0x22])

export interface TokenRequest {
  code: string
  codeVerifier: string
  notaryAddress: string
}

export interface TokenResponse {
  accessToken: string
  tokenAttestation: NotaryAttestation
  bearerOpening: Uint8Array
}

export interface TokenExchangeBinding {
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}

export interface AdmittedTokenResponse {
  decoded: DecodedAttestedData
  bearer: CorrelatedCommitment
}

function invalid(reason: string): never {
  throw new Error(`invalid GitHub token payload: ${reason}`)
}

/** Encode the exact bounded browser-to-server request. */
export function encodeTokenRequest(value: unknown): Uint8Array {
  if (!isRecord(value) || !hasExactKeys(value, ['code', 'codeVerifier', 'notaryAddress'])) {
    return invalid('request shape')
  }
  if (!origin(value.notaryAddress)) return invalid('notary origin')
  if (typeof value.code !== 'string' || !CODE.test(value.code)) return invalid('code')
  if (typeof value.codeVerifier !== 'string' || !CODE_VERIFIER.test(value.codeVerifier)) {
    return invalid('code verifier')
  }
  return new TextEncoder().encode(
    JSON.stringify({
      code: value.code,
      codeVerifier: value.codeVerifier,
      notaryAddress: value.notaryAddress,
    }),
  )
}

function decodeBytes(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string') return invalid('byte field type')
  const decoded = b64urlDecode(value)
  if (
    decoded === null ||
    (length === undefined ? decoded.length === 0 : decoded.length !== length)
  ) {
    return invalid('noncanonical or invalid byte field')
  }
  return decoded
}

function sameRange(actual: DecodedRangeCommitment, start: number, end: number): boolean {
  return actual.start === start && actual.end === end
}

function requireRequest(decoded: DecodedAttestedData, binding: TokenExchangeBinding): void {
  const { revealed, commitments } = decoded.sent
  const [line, ...fields] = revealed
  if (
    revealed.length !== 5 ||
    commitments.length !== 2 ||
    line.start !== 0 ||
    !bytesEqual(line.bytes, REQUEST_LINE)
  )
    invalid('request layout')
  const expected = new URLSearchParams([
    ['client_id', binding.clientId],
    ['code', binding.code],
    ['redirect_uri', binding.redirectUri],
    ['code_verifier', binding.codeVerifier],
  ])
    .toString()
    .split('&')
    .map((field, index) => encoder.encode(field + (index < 3 ? '&' : '')))
  let end = fields[0].start
  if (end <= REQUEST_LINE.length || !sameRange(commitments[0], REQUEST_LINE.length, end))
    invalid('hidden request headers')
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    if (field.start !== end || !bytesEqual(field.bytes, expected[index]))
      invalid('request bindings')
    end += field.bytes.length
  }
  if (
    end >= decoded.sentTranscriptLength ||
    !sameRange(commitments[1], end, decoded.sentTranscriptLength)
  )
    invalid('hidden client secret')
}

function receivedCommitmentRanges(
  delimiterStart: number,
  bearerStart: number,
  bearerEnd: number,
  transcriptLength: number,
): readonly [number, number][] {
  const ranges: [number, number][] = []
  if (delimiterStart > 0) ranges.push([0, delimiterStart])
  ranges.push([bearerStart, bearerEnd])
  if (bearerEnd + 1 < transcriptLength) ranges.push([bearerEnd + 1, transcriptLength])
  return ranges
}

function requireBearer(
  response: TokenResponse,
  decoded: DecodedAttestedData,
): CorrelatedCommitment {
  if (decoded.received.revealed.length !== 2) return invalid('response reveal layout')
  const [delimiter, closingQuote] = decoded.received.revealed
  const bearerStart = delimiter.start + delimiter.bytes.length
  if (
    !bytesEqual(delimiter.bytes, ACCESS_TOKEN_DELIMITER) ||
    !bytesEqual(closingQuote.bytes, QUOTE) ||
    closingQuote.start <= bearerStart
  ) {
    return invalid('access token framing')
  }

  const ranges = receivedCommitmentRanges(
    delimiter.start,
    bearerStart,
    closingQuote.start,
    decoded.receivedTranscriptLength,
  )
  if (
    decoded.received.commitments.length !== ranges.length ||
    decoded.received.commitments.some(
      (commitment, index) => !sameRange(commitment, ranges[index][0], ranges[index][1]),
    )
  ) {
    return invalid('response coverage')
  }

  const bearer = decoded.received.commitments.find(({ start, end }) => {
    return start === bearerStart && end === closingQuote.start
  })
  const accessToken = encoder.encode(response.accessToken)
  if (bearer === undefined || bearer.end - bearer.start !== accessToken.length) {
    return invalid('access token range')
  }
  if (!(response.bearerOpening instanceof Uint8Array) || response.bearerOpening.length !== 16) {
    return invalid('bearer opening')
  }
  const preimage = new Uint8Array(accessToken.length + response.bearerOpening.length)
  preimage.set(accessToken)
  preimage.set(response.bearerOpening, accessToken.length)
  const hash = sha256(preimage)
  if (!bytesEqual(hash, bearer.commitment)) return invalid('bearer commitment')
  return {
    start: bearer.start,
    end: bearer.end,
    hash,
    blinder: response.bearerOpening.slice(),
  }
}

/** Decode one complete bounded server response into its byte-level values. */
export function decodeTokenResponse(body: Uint8Array): TokenResponse {
  if (!(body instanceof Uint8Array) || body.length > MAX_RESPONSE_BYTES) {
    return invalid('response size')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return invalid('UTF-8')
  }
  const value = parseJson(text)
  if (!isRecord(value)) return invalid('response shape')
  if (!hasExactKeys(value, ['accessToken', 'tokenAttestation', 'bearerOpening'])) {
    return invalid('response shape')
  }
  if (typeof value.accessToken !== 'string' || !ACCESS_TOKEN.test(value.accessToken)) {
    return invalid('access token')
  }
  if (
    !isRecord(value.tokenAttestation) ||
    !hasExactKeys(value.tokenAttestation, ['attestedData', 'signature'])
  ) {
    return invalid('attestation shape')
  }
  const attestedData = decodeBytes(value.tokenAttestation.attestedData)
  if (attestedData.length > MAX_ATTESTED_DATA_BYTES) return invalid('attested data size')
  return {
    accessToken: value.accessToken,
    tokenAttestation: {
      attestedData,
      signature: decodeBytes(value.tokenAttestation.signature, 65),
    },
    bearerOpening: decodeBytes(value.bearerOpening, 16),
  }
}

/** Admit one decoded server response before its bearer reaches dependent work. */
export function admitTokenResponse(
  response: TokenResponse,
  binding: TokenExchangeBinding,
): AdmittedTokenResponse {
  const decoded = decodeAttestedData(response.tokenAttestation.attestedData)
  if (!bytesEqual(decoded.authorityId, keccak_256(encoder.encode('github.com'))))
    return invalid('authority')
  requireRequest(decoded, binding)
  return { decoded, bearer: requireBearer(response, decoded) }
}
