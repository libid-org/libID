import { describe, expect, it } from 'vitest'
import { identityRequest, selectIdentity } from '../platforms/github/1/transcript.js'
import {
  buildIdentityRequest,
  buildTokenRequest,
  selectIdentityReveals,
  selectTokenReveals,
} from '../platforms/x/1/transcript.js'
import { planNotarization } from './notarize.js'
import type { ExactHttpRequest } from './session.js'
import { quotedRange } from './transcript.js'

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
  })
  it('admits additional headers and normalizes required names and HTTP whitespace', () => {
    for (const sent of [
      text(transcript.sent)
        .replace('accept: application/json\r\n', '')
        .replace('connection: close\r\n', ''),
      text(transcript.sent).replace(
        'accept: application/json',
        'accept: text/plain\r\naccept: application/json',
      ),
      text(transcript.sent).replace('host: api.x.com', 'HOST \t:\tapi.x.com \t'),
      text(transcript.sent).replace('content-type: ', 'CONTENT_TYPE:\t'),
      text(transcript.sent).replace('accept:', 'x-extra: café 😀\r\nx-extra:\r\naccept:'),
    ]) {
      const changed = { ...transcript, sent: utf8(sent) }
      const selected = selectTokenReveals(changed, input)
      expect(selected.accessToken).toBe('token')
      expect(selected.ranges.sent).toEqual([{ start: 0, end: changed.sent.length }])
    }
  })
  it.each([
    'Authorization: Basic other',
    'Cookie: session=other',
    'Content_Encoding: gzip',
    'Transfer-Encoding: chunked',
    'X_HTTP_Method_Override: POST',
    'X-Http-Method: POST',
    'X-Method-Override: POST',
  ])('rejects forbidden token header %s [REQ-PLAT-56A]', (header) => {
    const sent = utf8(text(transcript.sent).replace('accept:', `${header}\r\naccept:`))
    expect(() => selectTokenReveals({ ...transcript, sent }, input)).toThrow()
  })
  it.each([
    ['host: api.x.com', 'host: other.com'],
    ['application/x-www-form-urlencoded', 'text/plain'],
    ['host: api.x.com\r\n', ''],
    ['host: api.x.com', 'host: api.x.com\r\nHOST: api.x.com'],
    ['content-type: ', 'content-type: application/x-www-form-urlencoded\r\ncontent_type: '],
    ['content-length: ', 'content-length: 3\r\ncontent_length: '],
    ['content-length: ', 'content-length: 000'],
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
  it.each([' ', '\t', '\r', '\n', ' \t\r\n'])(
    'preserves original whitespace in revealed GitHub fields: %j',
    (space) => {
      const id = `"id"${space}:${space}123${space},`
      const login = `"login"${space}:${space}"alice"`
      const received = utf8(`HTTP/1.1 200 OK\r\n\r\n{${id}\n${login}}`)
      const selected = selectIdentity({ sent, received }, 'token')
      expect(selected.userId).toBe('123')
      expect(selected.userName).toBe('alice')
      expect(
        selected.ranges.received.map(({ start, end }) => text(received.slice(start, end))),
      ).toEqual([id, login])
    },
  )
  it.each(['"123"', '0123', '123.4', '123e2', '123 4', '18446744073709551616'])(
    'still rejects invalid spaced IDs: %s',
    (id) => {
      const received = utf8(`{"id": ${id}, "login": "alice"}`)
      expect(() => selectIdentity({ sent, received }, 'token')).toThrow()
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

for (const platform of ['x', 'github'] as const) {
  describe(`${platform} additional identity headers [LIBID-PROVER-003/004]`, () => {
    const request = platform === 'x' ? buildIdentityRequest('token') : identityRequest('token')
    const line = platform === 'x' ? 'GET /2/users/me HTTP/1.1' : 'GET /user HTTP/1.1'
    const original = text(serialize(line, request))
    const received = utf8(
      platform === 'x' ? '{"id":"123","username":"alice"}' : '{"id":123,"login":"alice"}',
    )
    const select = (sent: Uint8Array) =>
      platform === 'x'
        ? selectIdentityReveals({ sent, recv: received }, 'token').sent
        : selectIdentity({ sent, received }, 'token').ranges.sent
    it.each(['x-extra: value', 'x-extra: café 😀', 'x-extra:', 'x-extra:\tvalue'])(
      'reveals extra headers before and after Authorization without shifting its bearer: %s',
      (extra) => {
        const sent = utf8(
          original.replace(
            'authorization: Bearer token\r\n',
            `${extra}\r\nauthorization: Bearer token\r\n${extra}\r\n`,
          ),
        )
        const ranges = select(sent)
        const plan = planNotarization({ sent, recv: received }, { sent: ranges, recv: [] })
        expect(plan.commit.sent).toHaveLength(1)
        const hole = plan.commit.sent[0]
        expect(text(sent.slice(hole.start, hole.end))).toBe('token')
        expect(ranges).toEqual([
          { start: 0, end: hole.start },
          { start: hole.end, end: sent.length },
        ])
      },
    )
    it.each([
      'Cookie: session=other',
      'Content_Encoding: gzip',
      'Transfer-Encoding: chunked',
      'X_HTTP_Method_Override: POST',
      'X-Http-Method: POST',
      'X-Method-Override: POST',
    ])('rejects forbidden identity header %s [REQ-COMMON-39B]', (header) => {
      expect(() => select(utf8(original.replace('host:', `${header}\r\nhost:`)))).toThrow()
    })
    it.each([
      ['authorization: Bearer token', 'authorization: Bearer token\r\nAuthorization: Bearer token'],
      ['authorization: Bearer token', 'authorization: Bearer token\r\nAuthorization: Basic other'],
      ['authorization: Bearer token', 'authorization: Bearer other'],
      ['authorization: Bearer token\r\n', ''],
      ['host: ', ' host: '],
      ['host: ', 'extra: x\nhost: '],
      ['host: ', 'extra: x\rhost: '],
      ['host: ', '\thost: '],
      ['host: ', 'extra: x\u0000\r\nhost: '],
      [line, line.replace(' HTTP', '?extra=1 HTTP')],
      ['\r\n\r\n', '\r\n\r\nbody'],
    ])('rejects ambiguous framing or changed required headers: %s', (from, to) => {
      expect(() => select(utf8(original.replace(from, to)))).toThrow()
    })
  })
}

describe('JSON field whitespace [LIBID-PROVER-003/004]', () => {
  it.each([' ', '\t', '\r', '\n', ' \t\r\n'])('keeps X bearer offsets with %j', (ws) => {
    const prefix = `"access_token"${ws}:${ws}"`
    const recv = utf8(`HTTP/1.1 200 OK\r\n\r\n{${prefix}token"}`)
    const selected = selectTokenReveals({ ...transcript, recv }, input)
    expect(text(recv.slice(selected.bearerRange.start, selected.bearerRange.end))).toBe('token')
    expect(selected.ranges.recv.map(({ start, end }) => text(recv.slice(start, end)))).toEqual([
      prefix,
      '"',
    ])
    const request = buildIdentityRequest('token')
    const identity = utf8(`{"id"${ws}:${ws}"123", "username"${ws}:${ws}"alice"}`)
    const reveals = selectIdentityReveals(
      { sent: serialize('GET /2/users/me HTTP/1.1', request), recv: identity },
      'token',
    )
    expect(reveals.recv.map(({ start, end }) => text(identity.slice(start, end)))).toEqual([
      `"id"${ws}:${ws}"123"`,
      `"username"${ws}:${ws}"alice"`,
    ])
  })
  it.each(['\v', '\f', '\u00a0'])('rejects non-JSON whitespace %j', (ws) => {
    expect(() => quotedRange(utf8(`{"login":${ws}"alice"}`), 'login')).toThrow()
    expect(() => quotedRange(utf8(`{"login"${ws}:"alice"}`), 'login')).toThrow()
  })
  it('rejects duplicates with different whitespace and incomplete values', () => {
    for (const body of ['{"login":"alice","login" : "bob"}', '{"login": "alice', '{"login" : '])
      expect(() => quotedRange(utf8(body), 'login')).toThrow()
  })
})
