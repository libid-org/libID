import { expect, it } from 'vitest'
import { responseJson } from './http.js'
const response = (headers: string, body: string) => ({
  sent: new Uint8Array(),
  received: new TextEncoder().encode(`HTTP/1.1 200 OK\r\n${headers}\r\n${body}`),
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
it('rejects ambiguous framing, truncated chunks, compressed bodies, and duplicate JSON members', () => {
  for (const transcript of [
    response('Transfer-Encoding: chunked\r\nContent-Length: 2\r\n', '{}'),
    response('Transfer-Encoding: chunked\r\n', '5\r\n{}\r\n0\r\n\r\n'),
    response('Content-Encoding: gzip\r\n', '{}'),
    response('Content-Length: 0\r\n', '{}'),
    response('', '{"id":1,"id":2}'),
  ])
    expect(() => responseJson(transcript)).toThrow()
})
