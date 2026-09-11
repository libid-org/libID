import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
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
  `POST /login/oauth/access_token HTTP/1.1\r\nhost: github.com\r\ncontent-type: application/x-www-form-urlencoded\r\naccept: application/json\r\nconnection: close\r\ncontent-length: ${utf8(`${REQUEST_BODY}&client_secret=deployment-secret`).length}\r\n\r\n${REQUEST_BODY}`,
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

const SENT: Direction = {
  length: REQUEST_LENGTH,
  revealed: [{ start: 0, bytes: REQUEST_PREFIX }],
  commitments: [
    { start: REQUEST_PREFIX.length, end: REQUEST_LENGTH, commitment: new Uint8Array(32).fill(2) },
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
  it.each([
    'https://notary.lib.id',
    'https://testnet.notary.lib.id',
    'https://development.test:8443',
  ])('forwards the resolved notary address unchanged: %s [KIT-013]', (notaryAddress) => {
    expect(
      JSON.parse(
        new TextDecoder().decode(
          encodeTokenRequest({
            code: 'github-code',
            codeVerifier: VERIFIER,
            redirectUri: BINDING.redirectUri,
            notaryAddress,
          }),
        ),
      ),
    ).toEqual({
      code: 'github-code',
      codeVerifier: VERIFIER,
      redirectUri: BINDING.redirectUri,
      notaryAddress,
    })
  })
  it('rejects missing, extra, wrongly typed, and out-of-bounds fields', () => {
    const valid = {
      code: 'a',
      codeVerifier: VERIFIER,
      redirectUri: BINDING.redirectUri,
      notaryAddress: 'https://notary.lib.id',
    }
    for (const patch of [
      { code: undefined },
      { extra: true },
      { code: 1 },
      { code: '' },
      { code: 'a b' },
      { code: 'a'.repeat(1025) },
      { codeVerifier: `${'a'.repeat(42)}+` },
      ...[
        undefined,
        null,
        0,
        'http://notary.test',
        'https://notary.test/',
        'https://user@notary.test',
        'https://notary.test/path',
      ].map((notaryAddress) => ({ notaryAddress })),
      ...[
        undefined,
        null,
        '',
        '/callback',
        'http://bridge.test/callback',
        'https://bridge.test/callback?',
        'https://bridge.test/callback#',
        'https://bridge.test/callback?x=1',
        'https://bridge.test/callback#x',
        'https://user@bridge.test/callback',
        `https://bridge.test/${'a'.repeat(2048)}`,
      ].map((redirectUri) => ({ redirectUri })),
      { isTestnet: false },
    ])
      expect(() => encodeTokenRequest({ ...valid, ...patch })).toThrow()
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
  it.each([' ', '\t', '\r', '\n', ' \t\r\n'])(
    'admits whitespace in the attested bearer anchor: %j',
    (ws) => {
      const delimiter = utf8(`"access_token"${ws}:${ws}"`)
      const shift = delimiter.length - DELIMITER.length
      const received: Direction = {
        length: RECEIVED.length + shift,
        revealed: [
          { start: RESPONSE_PREFIX.length, bytes: delimiter },
          { start: BEARER_END + shift, bytes: utf8('"') },
        ],
        commitments: RECEIVED.commitments.map((c, i) =>
          i === 0
            ? c
            : {
                ...c,
                start: c.start + shift,
                end: c.end + shift,
              },
        ),
      }
      const admitted = admitTokenResponse(response(SENT, received), BINDING)
      expect(admitted.bearer.start).toBe(BEARER_START + shift)
      expect(admitted.bearer.end).toBe(BEARER_END + shift)
    },
  )
  it('accepts one revealed request prefix and a committed secret suffix without signature verification', () => {
    const admitted = admitTokenResponse(response(), BINDING)
    expect(admitted.bearer.hash).toEqual(bearerHash)
    expect(admitted.decoded.sent.revealed).toHaveLength(1)
  })
  it('rejects hidden headers, altered bindings and bearer correlation', () => {
    expect(() =>
      admitTokenResponse(
        response({
          ...SENT,
          revealed: [{ start: 0, bytes: utf8('POST /login/oauth/access_token HTTP/1.1\r\n') }],
          commitments: SENT.commitments,
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

it('checks GitHub token head framing against the signed length [REQ-PLAT-56A/B/C]', () => {
  const original = new TextDecoder().decode(REQUEST_PREFIX)
  const contentLength = String(utf8(`${REQUEST_BODY}&client_secret=deployment-secret`).length)
  const admitHead = (changed: string) => {
    const prefix = utf8(changed)
    const length = REQUEST_LENGTH + prefix.length - REQUEST_PREFIX.length
    return admitTokenResponse(
      response({
        length,
        revealed: [{ start: 0, bytes: prefix }],
        commitments: [{ ...SENT.commitments[0], start: prefix.length, end: length }],
      }),
      BINDING,
    )
  }
  for (const changed of [
    original.replace('connection: close\r\n', '').replace('accept: application/json\r\n', ''),
    original.replace('accept: application/json', 'accept: application/json\r\naccept: text/plain'),
    original.replace('host: github.com', 'HOST \t:\tgithub.com \t'),
    original.replace('content-type: ', 'CONTENT_TYPE:\t'),
    original.replace('accept:', 'x-extra: café 😀\r\nx-extra:\r\naccept:'),
  ]) {
    expect(admitHead(changed).bearer.hash).toEqual(bearerHash)
  }
  for (const changed of [
    original.replace('host: github.com', 'host: evil.test'),
    original.replace(
      `content-length: ${contentLength}`,
      `content-length: ${Number(contentLength) - 1}`,
    ),
    original.replace('host: github.com\r\n', ''),
    original.replace('content-length: ', 'content-length: 000'),
    original.replace('content-length: ', 'content-length: 3\r\ncontent_length: '),
    original.replace('host: github.com', 'host: github.com\r\nHOST: github.com'),
    ...[
      'Authorization: Basic other',
      'Cookie: session=other',
      'Content_Encoding: gzip',
      'Transfer-Encoding: chunked',
      'X_HTTP_Method_Override: POST',
      'X-Http-Method: POST',
      'X-Method-Override: POST',
    ].map((header) => original.replace('accept:', `${header}\r\naccept:`)),
    original.replace('\r\nhost:', '\nhost:'),
    original.replace('host: github.com\r\n', 'host: github.com\n\r\n'),
    original.replace('\r\nhost:', '\r\n host:'),
  ]) {
    expect(() => admitHead(changed)).toThrow()
  }
  for (const change of [-1, 1]) {
    expect(() =>
      admitTokenResponse(
        response({
          ...SENT,
          commitments: [{ ...SENT.commitments[0], start: REQUEST_PREFIX.length + change }],
        }),
        BINDING,
      ),
    ).toThrow()
  }
})
