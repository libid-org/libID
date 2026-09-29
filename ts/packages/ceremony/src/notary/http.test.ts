import { concatBytes } from '@noble/hashes/utils.js'
import { expect, it } from 'vitest'
import { responseJson } from './http.js'

const encode = (text: string) => new TextEncoder().encode(text)

const response = (headers: string, body: string) => ({
  sent: new Uint8Array(),
  received: encode(`HTTP/1.1 200 OK\r\n${headers}\r\n${body}`),
})

it('parses chunked JSON without altering the transcript used for range commitments', () => {
  const transcript = response(
      'Transfer-Encoding: chunked\r\n',
      '6\r\n{"id":\r\n2\r\n1}\r\n0\r\n\r\n',
    ),
    original = transcript.received.slice()
  expect(responseJson(transcript)).toEqual({ id: 1 })
  expect(transcript.received).toEqual(original)
})

it('decodes UTF-8 only after removing chunk framing that splits a character', () => {
  const json = encode('{"id":1,"name":"é"}'),
    split = json.indexOf(0xc3) + 1
  const received = concatBytes(
    encode(`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${split.toString(16)}\r\n`),
    json.subarray(0, split),
    encode(`\r\n${(json.length - split).toString(16)}\r\n`),
    json.subarray(split),
    encode('\r\n0\r\n\r\n'),
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
