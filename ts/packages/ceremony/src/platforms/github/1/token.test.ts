import { keccak_256 } from '@noble/hashes/sha3.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { b64urlEncode } from '../../../primitives.js'
import {
  admitTokenResponse,
  decodeTokenResponse,
  encodeTokenRequest,
  type TokenExchangeBinding,
  type TokenResponse,
} from './token.js'

const VERIFIER = 'c8HLMaJOzc8OUoRYc7AocL5ioAkXVtAOmoGxoSY60IQ'
const utf8 = (value: string) => new TextEncoder().encode(value)

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const integer = (value: number | bigint, bytes: 4 | 8): Uint8Array => {
  const out = new Uint8Array(bytes)
  const view = new DataView(out.buffer)
  if (bytes === 4) view.setUint32(0, Number(value))
  else view.setBigUint64(0, BigInt(value))
  return out
}

interface Reveal {
  start: number
  bytes: Uint8Array
}

interface Commitment {
  start: number
  end: number
  commitment: Uint8Array
}

interface Direction {
  length: number
  revealed: readonly Reveal[]
  commitments: readonly Commitment[]
}

const encodeDirection = ({ revealed, commitments }: Direction): Uint8Array =>
  concat(
    integer(revealed.length, 8),
    ...revealed.flatMap(({ start, bytes }) => [integer(start, 4), integer(bytes.length, 8), bytes]),
    integer(commitments.length, 8),
    ...commitments.flatMap(({ start, end, commitment }) => [
      integer(start, 4),
      integer(end, 4),
      commitment,
    ]),
  )

const encodeAttestedData = (sent: Direction, received: Direction, createdAt = 1_770_000_000n) =>
  concat(
    keccak_256(utf8('github.com')),
    integer(createdAt, 8),
    integer(sent.length, 4),
    integer(received.length, 4),
    encodeDirection(sent),
    encodeDirection(received),
  )

const encodedResponse = (overrides: Record<string, unknown> = {}) =>
  utf8(
    JSON.stringify({
      accessToken: 'gho_token',
      tokenAttestation: {
        attestedData: b64urlEncode(new Uint8Array([1, 2, 3])),
        signature: b64urlEncode(new Uint8Array(65).fill(4)),
      },
      bearerOpening: b64urlEncode(new Uint8Array(16).fill(5)),
      ...overrides,
    }),
  )

const BINDING = {
  clientId: 'Iv1.example',
  code: 'github-code',
  redirectUri: 'https://server.example/auth/v1/callback',
  codeVerifier: VERIFIER,
} satisfies TokenExchangeBinding
const REQUEST_BODY = new URLSearchParams([
  ['client_id', BINDING.clientId],
  ['code', BINDING.code],
  ['redirect_uri', BINDING.redirectUri],
  ['code_verifier', BINDING.codeVerifier],
]).toString()
const REQUEST_PREFIX = utf8(
  `POST /login/oauth/access_token HTTP/1.1\r\nhost: github.com\r\ncontent-type: application/x-www-form-urlencoded\r\naccept: application/json\r\n\r\n${REQUEST_BODY}`,
)
const REQUEST_LENGTH = REQUEST_PREFIX.length + utf8('&client_secret=deployment-secret').length
const ACCESS_TOKEN = 'gho_launch_token'
const OPENING = Uint8Array.from(Array.from({ length: 16 }, (_, index) => index))
const RESPONSE_PREFIX = utf8('HTTP/1.1 200 OK\r\n\r\n{"token_type":"bearer",')
const DELIMITER = utf8('"access_token":"')
const RESPONSE_SUFFIX = utf8('","scope":"read:user"}')
const BEARER_START = RESPONSE_PREFIX.length + DELIMITER.length
const BEARER_END = BEARER_START + ACCESS_TOKEN.length
const RESPONSE_LENGTH = BEARER_END + RESPONSE_SUFFIX.length
const bearerHash = sha256(concat(utf8(ACCESS_TOKEN), OPENING))

const line = utf8('POST /login/oauth/access_token HTTP/1.1\r\n')
const fields = REQUEST_BODY.split('&').map((field, index) => utf8(field + (index < 3 ? '&' : '')))
let fieldOffset = REQUEST_PREFIX.length - REQUEST_BODY.length
const fieldStart = fieldOffset
const SENT: Direction = {
  length: REQUEST_LENGTH,
  revealed: [
    { start: 0, bytes: line },
    ...fields.map((bytes) => {
      const range = { start: fieldOffset, bytes }
      fieldOffset += bytes.length
      return range
    }),
  ],
  commitments: [
    { start: line.length, end: fieldStart, commitment: new Uint8Array(32).fill(1) },
    { start: fieldOffset, end: REQUEST_LENGTH, commitment: new Uint8Array(32).fill(2) },
  ],
}
const RECEIVED: Direction = {
  length: RESPONSE_LENGTH,
  revealed: [
    { start: RESPONSE_PREFIX.length, bytes: DELIMITER },
    { start: BEARER_END, bytes: utf8('"') },
  ],
  commitments: [
    { start: 0, end: RESPONSE_PREFIX.length, commitment: new Uint8Array(32).fill(2) },
    { start: BEARER_START, end: BEARER_END, commitment: bearerHash },
    { start: BEARER_END + 1, end: RESPONSE_LENGTH, commitment: new Uint8Array(32).fill(3) },
  ],
}

// Synthetic profile fixture in the separately vector-tested canonical bincode format.
const response = (
  sent: Direction = SENT,
  received: Direction = RECEIVED,
  createdAt?: bigint,
): TokenResponse => ({
  accessToken: ACCESS_TOKEN,
  tokenAttestation: {
    attestedData: encodeAttestedData(sent, received, createdAt),
    signature: new Uint8Array(65).fill(4),
  },
  bearerOpening: OPENING,
})

describe('GitHub TokenRequest codec', () => {
  it('encodes the exact bounded UTF-8 JSON request', () => {
    expect(
      new TextDecoder().decode(encodeTokenRequest({ code: 'github-code', codeVerifier: VERIFIER })),
    ).toBe(`{"code":"github-code","codeVerifier":"${VERIFIER}"}`)
  })

  it('rejects missing, extra, wrongly typed, and out-of-bounds fields', () => {
    for (const value of [
      {},
      { code: 'a', codeVerifier: VERIFIER, extra: true },
      { code: 1, codeVerifier: VERIFIER },
      { code: '', codeVerifier: VERIFIER },
      { code: 'a b', codeVerifier: VERIFIER },
      { code: 'a'.repeat(1025), codeVerifier: VERIFIER },
      { code: 'a', codeVerifier: `${'a'.repeat(42)}+` },
    ]) {
      expect(() => encodeTokenRequest(value), JSON.stringify(value)).toThrow()
    }
  })
})

describe('GitHub TokenResponse codec', () => {
  it('decodes exact bytes independent of member order and JSON whitespace', () => {
    const body = utf8(`{
      "bearerOpening" : "${b64urlEncode(new Uint8Array(16).fill(5))}",
      "tokenAttestation" : {
        "signature" : "${b64urlEncode(new Uint8Array(65).fill(4))}",
        "attestedData" : "AQID"
      },
      "accessToken" : "gho_token"
    }`)
    expect(decodeTokenResponse(body)).toEqual({
      accessToken: 'gho_token',
      tokenAttestation: {
        attestedData: new Uint8Array([1, 2, 3]),
        signature: new Uint8Array(65).fill(4),
      },
      bearerOpening: new Uint8Array(16).fill(5),
    })
  })

  it('rejects missing, extra, duplicate, and wrongly typed members', () => {
    const validAttestation = `{"attestedData":"AQID","signature":"${b64urlEncode(new Uint8Array(65))}"}`
    for (const body of [
      '{}',
      new TextDecoder().decode(encodedResponse({ extra: true })),
      new TextDecoder().decode(encodedResponse({ accessToken: 1 })),
      new TextDecoder().decode(encodedResponse({ tokenAttestation: 'not-an-attestation' })),
      new TextDecoder().decode(encodedResponse({ bearerOpening: 1 })),
      new TextDecoder().decode(
        encodedResponse({
          tokenAttestation: {
            attestedData: 1,
            signature: b64urlEncode(new Uint8Array(65)),
          },
        }),
      ),
      `{"accessToken":"a","accessToken":"b","tokenAttestation":${validAttestation},"bearerOpening":"${b64urlEncode(new Uint8Array(16))}"}`,
      `{"accessToken":"a","tokenAttestation":{"attestedData":"AQID","attestedData":"AQID","signature":"${b64urlEncode(new Uint8Array(65))}"},"bearerOpening":"${b64urlEncode(new Uint8Array(16))}"}`,
      `{"accessToken":"a","tokenAttestation":${validAttestation},"bearerOpening":"${b64urlEncode(new Uint8Array(16))}","\\u0061ccessToken":"b"}`,
    ]) {
      expect(() => decodeTokenResponse(utf8(body)), body).toThrow()
    }
  })

  it('rejects malformed, oversized, and noncanonical encodings', () => {
    for (const body of [
      utf8('{'),
      utf8('{} trailing'),
      new Uint8Array([0x7b, 0x22, 0x80]),
      new Uint8Array(3 * 1024 * 1024 + 1),
      encodedResponse({ accessToken: '' }),
      encodedResponse({ accessToken: 'a b' }),
      encodedResponse({ accessToken: 'a'.repeat(129) }),
      encodedResponse({ bearerOpening: b64urlEncode(new Uint8Array(15)) }),
      encodedResponse({ bearerOpening: 'AA==' }),
      encodedResponse({
        tokenAttestation: {
          attestedData: '',
          signature: b64urlEncode(new Uint8Array(65)),
        },
      }),
      encodedResponse({
        tokenAttestation: {
          attestedData: 'A',
          signature: b64urlEncode(new Uint8Array(65)),
        },
      }),
      encodedResponse({
        tokenAttestation: {
          attestedData: 'AQID',
          signature: b64urlEncode(new Uint8Array(64)),
        },
      }),
      encodedResponse({
        tokenAttestation: {
          attestedData: b64urlEncode(new Uint8Array(2 * 1024 * 1024 + 1)),
          signature: b64urlEncode(new Uint8Array(65)),
        },
      }),
    ]) {
      expect(() => decodeTokenResponse(body)).toThrow()
    }
  })
})

describe('GitHub admission [LIBID-PROVER-004]', () => {
  it('accepts current hidden-header disclosures without signature verification', () => {
    const admitted = admitTokenResponse(response(), BINDING)
    expect(admitted.bearer.hash).toEqual(bearerHash)
    expect(admitted.decoded.sent.revealed).toHaveLength(5)
  })
  it('rejects obsolete exposed headers, altered bindings and bearer correlation', () => {
    expect(() =>
      admitTokenResponse(
        response({
          ...SENT,
          revealed: [{ start: 0, bytes: REQUEST_PREFIX }],
          commitments: [SENT.commitments[1]],
        }),
        BINDING,
      ),
    ).toThrow()
    for (const key of ['clientId', 'code', 'redirectUri', 'codeVerifier'] as const)
      expect(() =>
        admitTokenResponse(response(), { ...BINDING, [key]: `${BINDING[key]}x` }),
      ).toThrow()
    expect(() => admitTokenResponse({ ...response(), accessToken: 'other' }, BINDING)).toThrow()
    expect(() =>
      admitTokenResponse({ ...response(), bearerOpening: new Uint8Array(16) }, BINDING),
    ).toThrow()
  })
})
