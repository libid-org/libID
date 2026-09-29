import { concatBytes } from '@noble/hashes/utils.js'
import { expect, it } from 'vitest'
import { utf8 } from '../testing/index.js'
import { responseJson, responseSizes } from './http.js'

const response = (headers: string, body: string) => ({
  sent: new Uint8Array(),
  received: utf8(`HTTP/1.1 200 OK\r\n${headers}\r\n${body}`),
})

it('parses chunked JSON without altering the transcript used for range commitments', () => {
  const transcript = response(
      'Transfer-Encoding: chunked\r\n',
      '6\r\n{"id":\r\n2\r\n1}\r\n0\r\n\r\n',
    ),
    original = transcript.received.slice()
  expect(responseJson(transcript)).toEqual({ id: 1 })
  expect(transcript.received).toEqual(original)
  expect(responseJson(response('X-Name: café\r\nContent-Length:\t2 \r\n', '{}'))).toEqual({})
})

it('decodes UTF-8 only after removing chunk framing that splits a character', () => {
  const json = utf8('{"id":1,"name":"é"}'),
    split = json.indexOf(0xc3) + 1
  const received = concatBytes(
    utf8(`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${split.toString(16)}\r\n`),
    json.subarray(0, split),
    utf8(`\r\n${(json.length - split).toString(16)}\r\n`),
    json.subarray(split),
    utf8('\r\n0\r\n\r\n'),
  )
  expect(responseJson({ sent: new Uint8Array(), received })).toEqual({ id: 1, name: 'é' })
})

it('rejects ambiguous framing, truncated chunks, compressed bodies, and malformed JSON', () => {
  for (const transcript of [
    response('Transfer-Encoding: chunked\r\nContent-Length: 2\r\n', '{}'),
    response('Transfer-Encoding: chunked\r\n', '5\r\n{}\r\n0\r\n\r\n'),
    response('Content-Encoding: gzip\r\n', '{}'),
    response('Content-Length: 0\r\n', '{}'),
    response('', '{"id":01}'),
    response('', '{"id":1,2:3}'),
    response('Content-Length : 3\r\n', '{}'),
    response('X: a\nContent-Length: 3\r\n', '{}'),
  ])
    expect(() => responseJson(transcript)).toThrow()
})

it.each([301, 302, 303, 307, 308])(
  'rejects a redirected notarized response: %s [TEST-COMMON-06]',
  (status) => {
    const transcript = response('Location: https://other.test/\r\n', '{"access_token":"untrusted"}')
    transcript.received = new TextEncoder().encode(
      new TextDecoder().decode(transcript.received).replace('200 OK', `${status} Redirect`),
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
