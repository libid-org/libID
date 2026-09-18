import { describe, expect, it } from 'vitest'
import type { ExactHttpRequest } from '../../../notary/session.js'
import { buildTokenRequest, selectToken, type TokenRequestInput } from './token.js'

const encoder = new TextEncoder(),
  decoder = new TextDecoder()
const input: TokenRequestInput = {
  clientId: 'Iv1.example',
  code: 'github-code',
  redirectUri: 'https://bridge.test/auth/callback',
  codeVerifier: 'c8HLMaJOzc8OUoRYc7AocL5ioAkXVtAOmoGxoSY60IQ',
  clientCredential: 'public&credential=with+delimiters%',
}
function transcript(request: ExactHttpRequest, body = '{"access_token":"ghu_fixture"}') {
  return {
    sent: encoder.encode(
      [
        'POST /login/oauth/access_token HTTP/1.1',
        ...Object.entries(request.headers).map(
          ([name, value]) => `${name}: ${decoder.decode(value)}`,
        ),
        '',
        decoder.decode(request.body),
      ].join('\r\n'),
    ),
    received: encoder.encode(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`),
  }
}

it('reveals the complete canonical five-field request, including the public credential [LIBID-PROVER-004]', () => {
  const request = buildTokenRequest(input)
  expect(request.url).toBe('https://github.com/login/oauth/access_token')
  const body = decoder.decode(request.body)
  expect([...new URLSearchParams(body)]).toEqual([
    ['client_id', input.clientId],
    ['code', input.code],
    ['redirect_uri', input.redirectUri],
    ['code_verifier', input.codeVerifier],
    ['client_secret', input.clientCredential],
  ])
  expect(body).toContain('client_secret=public%26credential%3Dwith%2Bdelimiters%25')
  const raw = transcript(request)
  const selected = selectToken(raw, input)
  expect(selected.ranges.sent).toEqual([{ start: 0, end: raw.sent.length }])
  expect(selected.accessToken).toBe('ghu_fixture')
  expect(
    decoder.decode(raw.received.slice(selected.bearerRange.start, selected.bearerRange.end)),
  ).toBe(selected.accessToken)
  expect(
    selected.ranges.received.map(({ start, end }) =>
      decoder.decode(raw.received.slice(start, end)),
    ),
  ).toEqual(['"access_token":"', '"'])
})

describe('complete form validation [LIBID-PROVER-004]', () => {
  const original = decoder.decode(buildTokenRequest(input).body)
  it.each([
    `${original}&code=second`,
    `${original}&grant_type=refresh_token`,
    `${original}&refresh_token=old`,
    `${original}&device_code=other`,
    `${original}&extra=value`,
    original.replace('client_id=', '%63lient_id='),
    original.replace('%3A', '%3a'),
    original.replace('github-code', '%67ithub-code'),
    original.replace('code=github-code', 'code='),
    original.split('&').reverse().join('&'),
    original.slice(0, original.indexOf('&client_secret=')),
    original.replace('%26credential%3D', '&credential='),
    `${original}&`,
  ])('rejects an altered form despite a matching Content-Length: %s', (body) => {
    const request = buildTokenRequest(input)
    request.body = encoder.encode(body)
    request.headers = { ...request.headers, 'Content-Length': encoder.encode(String(body.length)) }
    expect(() => selectToken(transcript(request), input)).toThrow()
  })
})

it.each(['clientId', 'code', 'redirectUri', 'codeVerifier', 'clientCredential'] as const)(
  'binds the complete request to the frozen %s',
  (field) => {
    const raw = transcript(buildTokenRequest(input))
    expect(() => selectToken(raw, { ...input, [field]: `${input[field]}x` })).toThrow()
  },
)

it.each(['', 'has space', 'trailing\n', '\tcredential', 'é', '\x7f'])(
  'rejects an invalid public credential %j before request construction',
  (clientCredential) => {
    expect(() => buildTokenRequest({ ...input, clientCredential })).toThrow()
  },
)

it.each([
  '{"access_token":""}',
  '{"access_token":"one","access_token":"two"}',
  '{"refresh_token":"ghr_fixture"}',
])('rejects an invalid bearer response %s', (body) => {
  expect(() => selectToken(transcript(buildTokenRequest(input), body), input)).toThrow()
})

it('retains GitHub response whitespace in the bearer framing [LIBID-PROVER-004]', () => {
  const raw = transcript(buildTokenRequest(input), '{ "access_token" : \n "ghu_fixture" }')
  const selected = selectToken(raw, input)
  expect(
    decoder.decode(
      raw.received.slice(selected.ranges.received[0].start, selected.ranges.received[0].end),
    ),
  ).toBe('"access_token" : \n "')
})
