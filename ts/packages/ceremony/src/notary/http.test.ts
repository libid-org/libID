import { expect, it } from 'vitest'
import { chunked, httpResponse, receivedOnly, utf8 } from '../testing/index.js'
import { responseJson, responseSizes } from './http.js'

const response = (head: string, body: string | Uint8Array) => receivedOnly(httpResponse(body, head))

const CHUNKED = 'Transfer-Encoding: chunked\r\n'

it('parses chunked JSON without altering the transcript used for range commitments', () => {
  const transcript = response(CHUNKED, chunked('{"id":', '1}')),
    original = transcript.received.slice()
  expect(responseJson(transcript)).toEqual({ id: 1 })
  expect(transcript.received).toEqual(original)
  expect(responseJson(response('X-Name: café\r\nContent-Length:\t2 \r\n', '{}'))).toEqual({})
})

it('decodes UTF-8 only after removing chunk framing that splits a character', () => {
  const json = utf8('{"id":1,"name":"é"}'),
    split = json.indexOf(0xc3) + 1
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
