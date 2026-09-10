import { describe, expect, it } from 'vitest'
import { buildTokenRequest, selectTokenReveals } from '../platforms/x/1/transcript.js'
import { identityRequest, selectIdentity } from '../platforms/github/1/transcript.js'
import { planNotarization } from './notarization/notarize.js'
import type { ExactHttpRequest } from './notarization/session.js'
const utf8 = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)
function serialize(line: string, request: ExactHttpRequest): Uint8Array {
  return utf8(
    `${line}\r\n${Object.entries(request.headers)
      .reverse()
      .map(([name, value]) => `${name.toLowerCase()}: ${text(value)}`)
      .join('\r\n')}\r\n\r\n${text(request.body)}`,
  )
}
const input = {
  clientId: 'client',
  code: 'code+with/slash',
  redirectUri: 'https://bridge.example/callback',
  codeVerifier: 'a'.repeat(43),
}
const request = buildTokenRequest(input)
const transcript = {
  sent: serialize('POST /2/oauth2/token HTTP/1.1', request),
  recv: utf8('HTTP/1.1 200 OK\r\n\r\n{"access_token":"token","token_type":"bearer"}'),
}
describe('X token disclosure [LIBID-PROVER-003, REQ-PLAT-56A/B/C]', () => {
  it('reveals the entire request, accepts reordered headers, and keeps the bearer committed', () => {
    expect(text(request.headers['Content-Length'])).toBe(String(request.body.length))
    const selected = selectTokenReveals(transcript, input)
    const plan = planNotarization(transcript, selected.ranges)
    expect(plan.reveal.sent).toEqual([{ start: 0, end: transcript.sent.length }])
    expect(plan.commit.sent).toEqual([])
    expect(plan.commit.recv).toContainEqual({ ...selected.bearerRange, algorithm: 'SHA256' })
    const padded = text(transcript.sent).replace('content-length: ', 'content-length: 000')
    expect(selectTokenReveals({ ...transcript, sent: utf8(padded) }, input).accessToken).toBe(
      'token',
    )
  })
  it.each([
    ['host: api.x.com', 'host: other.com'],
    ['application/x-www-form-urlencoded', 'text/plain'],
    ['connection: close\r\n', ''],
    ['accept: application/json', 'accept: application/json\r\naccept: application/json'],
    ['accept: application/json', 'accept: application/json\r\ntransfer-encoding: chunked'],
    [`content-length: ${request.body.length}`, `content-length: ${request.body.length - 1}`],
    ['content-length: ', 'content-length: +'],
    ['\r\nhost:', '\nhost:'],
    ['host: api.x.com\r\n', 'host: api.x.com\n\r\n'],
    ['\r\nhost:', '\r\n host:'],
    ['\r\nhost:', '\r\n\thost:'],
    ['grant_type=authorization_code', 'grant_type=refresh_token'],
    ['client_id=client', 'client_id=otherx'],
    ['code=code%2Bwith%2Fslash', 'code=code%2bwith%2fslash'],
  ])('rejects altered framing or binding: %s', (from, to) => {
    expect(() =>
      selectTokenReveals(
        { ...transcript, sent: utf8(text(transcript.sent).replace(from, to)) },
        input,
      ),
    ).toThrow()
  })
})

describe('GitHub identity disclosure [LIBID-PROVER-004, REQ-PLAT-60]', () => {
  const request = identityRequest('token')
  const sent = serialize('GET /user HTTP/1.1', request)
  it.each(['{"id":123,"login":"alice"}', '{"login":"alice","id":123}'])(
    'accepts field order %s',
    (body) => {
      const received = utf8(`HTTP/1.1 200 OK\r\n\r\n${body}`)
      const selected = selectIdentity({ sent, received }, 'token')
      const plan = planNotarization(
        { sent, recv: received },
        { sent: selected.ranges.sent, recv: selected.ranges.received },
      )
      expect(selected.userId).toBe('123')
      expect(selected.userName).toBe('alice')
      expect(plan.reveal.recv.map((r) => text(received.slice(r.start, r.end)))).toEqual(
        body.startsWith('{"id"') ? ['"id":123,"login":"alice"'] : ['"login":"alice"', '"id":123}'],
      )
      expect(plan.commit.sent).toEqual([{ ...selected.bearerRange, algorithm: 'SHA256' }])
    },
  )
  it('pins the API version and forwards the browser User-Agent, rejecting missing or duplicate headers', () => {
    expect(text(request.headers['X-GitHub-Api-Version'])).toBe('2022-11-28')
    expect(text(request.headers['User-Agent'])).toBe(navigator.userAgent)
    const received = utf8('{"id":123,"login":"alice"}')
    for (const header of [
      'x-github-api-version: 2022-11-28',
      `user-agent: ${navigator.userAgent}`,
    ]) {
      for (const replacement of ['', `${header}\r\n${header}\r\n`]) {
        expect(() =>
          selectIdentity(
            { sent: utf8(text(sent).replace(`${header}\r\n`, replacement)), received },
            'token',
          ),
        ).toThrow()
      }
    }
  })
})
