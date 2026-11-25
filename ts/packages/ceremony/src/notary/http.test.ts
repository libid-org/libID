import { expect, it } from 'vitest'
import { chunked, httpResponse, receivedOnly, utf8 } from '../testing/index.js'
import { PlatformRefusal, responseJson, responseSizes } from './http.js'

const response = (head: string, body: string | Uint8Array) => receivedOnly(httpResponse(body, head))

const CHUNKED = 'Transfer-Encoding: chunked\r\n'

it('parses chunked JSON without altering the transcript used for range commitments', () => {
  const transcript = response(CHUNKED, chunked('{"id":', '1}'))
  const original = transcript.received.slice()
  expect(responseJson(transcript)).toEqual({ id: 1 })
  expect(transcript.received).toEqual(original)
  expect(responseJson(response('X-Name: café\r\nContent-Length:\t2 \r\n', '{}'))).toEqual({})
})

it('decodes UTF-8 only after removing chunk framing that splits a character', () => {
  const json = utf8('{"id":1,"name":"é"}')
  const split = json.indexOf(0xc3) + 1
  const transcript = response(CHUNKED, chunked(json.subarray(0, split), json.subarray(split)))
  expect(responseJson(transcript)).toEqual({ id: 1, name: 'é' })
})

it('rejects ambiguous framing, truncated chunks, compressed bodies, and malformed JSON', () => {
  for (const transcript of [
    response(`${CHUNKED}Content-Length: 2\r\n`, '{}'),
    response(CHUNKED, '5\r\n{}\r\n0\r\n\r\n'),
    response('Content-Encoding: gzip\r\n', '{}'),
    response('Content-Length: 0\r\n', '{}'),
    response('', '{"id":01}'),
    response('', '{"id":1,2:3}'),
    response('Content-Length : 3\r\n', '{}'),
    response('X: a\nContent-Length: 3\r\n', '{}'),
  ])
    expect(() => responseJson(transcript)).toThrow()
})

it('reports malformed JSON without quoting the body, which may hold the bearer', () => {
  expect(() => responseJson(response('', '{"access_token":gho_SECRET}'))).toThrow(
    /^Invalid JSON response$/,
  )
})

it.each([
  [
    'a missing head terminator',
    receivedOnly(utf8('HTTP/1.1 200 OK\r\n{}')),
    'Invalid HTTP response',
  ],
  [
    'a control character in the status line',
    receivedOnly(utf8('HTTP/1.1 200 OK\u0000\r\n\r\n{}')),
    'Invalid HTTP response',
  ],
  ['an invalid field name', response('Bad Name: x\r\n', '{}'), 'Invalid HTTP header'],
  [
    'an empty Transfer-Encoding beside a length',
    response('Transfer-Encoding: \r\nContent-Length: 2\r\n', '{}'),
    'Ambiguous HTTP framing',
  ],
  [
    'a framing header repeated in another case',
    response('Content-Length: 2\r\ncontent-length: 2\r\n', '{}'),
    'Duplicate framing header',
  ],
  ['a chunk extension', response(CHUNKED, '2;x=1\r\n{}\r\n0\r\n\r\n'), 'Invalid chunk size'],
  ['a chunk missing its CRLF', response(CHUNKED, '2\r\n{}0\r\n\r\n'), 'Truncated chunk'],
  ['a chunked trailer', response(CHUNKED, '2\r\n{}\r\n0\r\nX: 1\r\n\r\n'), 'Invalid final chunk'],
])('names the framing failure for %s', (_name, transcript, reason) => {
  expect(() => responseJson(transcript)).toThrow(reason)
})

it.each([301, 302, 303, 307, 308])(
  'rejects a redirected notarized response: %s [TEST-COMMON-06]',
  (status) => {
    const transcript = receivedOnly(
      httpResponse(
        '{"access_token":"untrusted"}',
        'Location: https://other.test/\r\n',
        `${status} Redirect`,
      ),
    )
    expect(() => responseJson(transcript)).toThrow('Platform request failed')
  },
)

it.each([
  { response: 'HTTP/1.1 200 OK\r\n\r\n\r\n\r\n', headerBytes: 19 },
  { response: 'HTTP/1.1 200 OK\r\nX: é\r\n\r\n', headerBytes: 26 },
  { response: 'No header boundary', headerBytes: undefined },
])(
  'splits raw response sizes at the first head terminator: $response [LIBID-PROVER-007]',
  ({ response, headerBytes }) => {
    const received = new Uint8Array(40)
    received.set(utf8(response))
    expect(responseSizes(received)).toEqual(
      headerBytes === undefined
        ? {}
        : { 'response-header-bytes': headerBytes, 'response-body-bytes': 40 - headerBytes },
    )
  },
)

const refusal = (transcript: ReturnType<typeof response>, secrets?: string[]) => {
  try {
    responseJson(transcript, secrets)
  } catch (error) {
    if (error instanceof PlatformRefusal) return error
    throw error
  }
  throw new Error('no refusal')
}

it('keeps what a refusing platform said: status, OAuth code, status line and body', () => {
  const body =
    '{"error":"invalid_request","error_description":"Value passed for the authorization code was invalid."}'
  const refused = refusal(
    receivedOnly(httpResponse(body, `Content-Length: ${body.length}\r\n`, '400 Bad Request')),
  )
  expect(refused).toMatchObject({ status: 400, code: 'invalid_request' })
  expect(refused.message).toBe(`Platform request failed: HTTP/1.1 400 Bad Request ${body}`)
})

it('keeps a refusal without JSON, and its status line when the framing is unreadable', () => {
  const text = refusal(receivedOnly(httpResponse('Too Many Requests', '', '429 Too Many Requests')))
  expect(text).toMatchObject({ status: 429, code: undefined })
  expect(text.message).toBe(
    'Platform request failed: HTTP/1.1 429 Too Many Requests Too Many Requests',
  )
  const unreadable = refusal(
    receivedOnly(httpResponse('{}', 'Content-Encoding: gzip\r\n', '503 Service Unavailable')),
  )
  expect(unreadable.message).toBe('Platform request failed: HTTP/1.1 503 Service Unavailable')
})

it('reads an OAuth error sent with a 200 as a refusal, never one beside a bearer', () => {
  const body =
    '{"error":"bad_verification_code","error_description":"The code passed is incorrect or expired."}'
  expect(refusal(response('', body))).toMatchObject({ status: 200, code: 'bad_verification_code' })
  expect(responseJson(response('', '{"access_token":"gho_SECRET","error":"x"}'))).toEqual({
    access_token: 'gho_SECRET',
    error: 'x',
  })
})

it('removes the secrets the request carried from what a refusal quotes', () => {
  const refused = refusal(
    receivedOnly(httpResponse('{"error":"invalid_grant","code":"c0de"}', '', '400 Bad Request')),
    ['c0de', ''],
  )
  expect(refused.message).toBe(
    'Platform request failed: HTTP/1.1 400 Bad Request {"error":"invalid_grant","code":"<redacted>"}',
  )
})
