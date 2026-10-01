import { PROOF_LIFETIME_SECONDS_GITHUB, PROOF_LIFETIME_SECONDS_X } from '@libid/contracts/ceremony'
import { describe, expect, it, vi } from 'vitest'
import { MAX_BEARER_BYTES } from '../../barretenberg/circuits/bearer-link/parameters.js'
import { LIBID_RS_ATTESTED_DATA } from '../../notary/fixtures/libid-rs.js'
import { planNotarization } from '../../notary/notarize.js'
import type { TokenRequestInput } from '../../notary/oauth/token.js'
import { MAX_CODE_CHARS } from '../../notary/oauth/validation.js'
import type { ExactHttpRequest, NotaryAttestation } from '../../notary/protocol.js'
import { NOTARY_SIGNATURE_BYTES } from '../../notary/protocol.js'
import {
  fixtures,
  httpResponse,
  notarizedPlatforms,
  proverRequest,
  returnSamples,
  text,
  utf8,
} from '../../testing/index.js'
import { ceremonyFor, platforms } from '../index.js'
import { parseOAuthReturn } from '../oauthReturn.js'
import { destroy, engine, generate, notarization, prepare } from './mocks.js'
import {
  fieldsOf,
  notarizedFailures,
  overLength,
  PKCE_VALUE,
  proverKinds,
  proverOf,
  requestHead,
  returnOf,
  setField,
  stageNotarized,
  tagged,
} from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

/** The text of each range of `bytes`. */
const revealed = (bytes: Uint8Array, ranges: readonly { start: number; end: number }[]) =>
  ranges.map(({ start, end }) => text(bytes.slice(start, end)))

/** JSON whitespace a selector must keep exact around member colons. */
const jsonWhitespace = [' ', '\t', '\r', '\n', ' \t\r\n']

/** `json` with `space` before and `after` after every member colon. */
const spaced = (json: string, space: string, after = space) =>
  json.replace(/"(\w+)"\s*:\s*/g, `"$1"${space}:${after}`)

/** A different valid value for each frozen token input. */
const frozenChanges: Record<keyof TokenRequestInput, string> = {
  clientId: 'other-client',
  code: 'other-code',
  redirectUri: 'https://bridge.test/other',
  codeVerifier: `B${PKCE_VALUE.slice(1)}`,
  clientCredential: 'other-credential',
}

/** `value` with its last character changed, keeping its length. */
const lastChanged = (value: string) => value.slice(0, -1) + (value.endsWith('a') ? 'b' : 'a')

/** Token forms that differ from `original` yet leave a well-formed request around them. */
function formChanges(original: string, code: string) {
  const fields = original.split('&')
  const [name] = fields[0].split('=')
  const escaped = (char: string) => `%${char.charCodeAt(0).toString(16)}`
  const changes = [
    `${original}&code=second`,
    `${original}&grant_type=refresh_token`,
    `${original}&refresh_token=old`,
    `${original}&device_code=other`,
    `${original}&extra=value`,
    `${original}&`,
    original.replace(`${name}=`, `${escaped(name[0])}${name.slice(1)}=`),
    original.replace(`code=${code}`, `code=${escaped(code[0])}${code.slice(1)}`),
    original.replace(`code=${code}`, 'code='),
    original.replace('%3A', '%3a'),
    [...fields].reverse().join('&'),
    fields.slice(0, -1).join('&'),
    ...fields.map((field) => original.replace(field, lastChanged(field))),
  ]
  // An escaped form delimiter inside a value must stay escaped.
  for (const delimiter of ['%26', '%3D', '%2B'])
    if (original.includes(delimiter))
      changes.push(original.replace(delimiter, decodeURIComponent(delimiter)))
  for (const change of changes) if (change === original) throw new Error(`No change: ${change}`)
  return changes
}

const proofLifetime = { x: PROOF_LIFETIME_SECONDS_X, github: PROOF_LIFETIME_SECONDS_GITHUB }

describe.each(notarizedPlatforms)('%s notarized prover', (platformId) => {
  const fixture = fixtures[platformId]
  const { requests, config, evidence, identity, longest, rejectedIdentity } = fixture
  const tags = `${proverKinds['notarized'].tags} ${fixture.specTests.prover}`

  it.each([
    ['a space', 'a+b'],
    ['an encoded space', 'a%20b'],
    [`${MAX_CODE_CHARS + 1} characters`, 'x'.repeat(MAX_CODE_CHARS + 1)],
  ])('rejects a code with %s at the redirect, before exchange [LIBID-OAUTH-007]', (_name, code) => {
    const accepted = fieldsOf(returnSamples(platformId).accepted.oauthReturn, fixture.returnRules)
    const changed = returnOf(setField(accepted, 'code', code), fixture.returnRules)
    expect(parseOAuthReturn(changed, platforms[platformId].versions[1].returnRules)).toBeNull()
  })

  describe('transcripts', () => {
    const tokenTags = fixture.transcriptTests.token
    const identityTags = fixture.transcriptTests.identity
    const input: TokenRequestInput = {
      ...config,
      code: returnSamples(platformId).accepted.credential,
      redirectUri: 'https://bridge.test/auth/callback',
      codeVerifier: PKCE_VALUE,
      // Form delimiters inside a public credential must stay inside its field.
      ...('clientCredential' in config
        ? { clientCredential: 'public&credential=with+delimiters%' }
        : {}),
    }
    const tokenUrl = new URL(fixture.tokenRequest.url)
    const identityUrl = new URL(fixture.identityRequest.url)
    /** A request as the TLSN prover writes it: lowercase names, reordered headers. */
    const tokenSent = (request: ExactHttpRequest = requests.token.build(input)) =>
      text(proverRequest(`POST ${tokenUrl.pathname} HTTP/1.1`, request))
    const token = (sent: string, body = evidence.tokenBody, frozen = input) =>
      requests.token.select({ sent: utf8(sent), received: httpResponse(body) }, frozen)
    const identitySent = text(
      proverRequest(
        `GET ${identityUrl.pathname} HTTP/1.1`,
        requests.identity.build(evidence.bearer),
      ),
    )
    const identityOf = (body: string, sent = identitySent) =>
      requests.identity.select({ sent: utf8(sent), received: httpResponse(body) }, evidence.bearer)
    const members = (body: string) => revealed(httpResponse(body), identityOf(body).ranges.received)

    it('selects exactly the identity its validators admit from the identity response', () => {
      const sent = requestHead(requests.identity.build(evidence.bearer))
      const select = (body: string) =>
        requests.identity.select(
          { sent, received: utf8(`HTTP/1.1 200 OK\r\n\r\n${body}`) },
          evidence.bearer,
        )
      expect(select(evidence.identityBody)).toMatchObject({
        userId: identity.userId,
        userName: identity.userName,
      })
      const named = (userName: string) =>
        evidence.identityBody.replace(JSON.stringify(identity.userName), JSON.stringify(userName))
      expect(select(named(longest.userName))).toMatchObject({ userName: longest.userName })
      for (const userName of rejectedIdentity.userName)
        expect(() => select(named(userName)), userName).toThrow('Invalid identity name')
      expect(() => select(named(overLength(longest.userName)))).toThrow('identity name length')
      for (const userId of [...rejectedIdentity.userId, overLength(longest.userId)])
        expect(
          () => select(evidence.identityBody.replace(identity.userId, userId)),
          userId,
        ).toThrow()
    })
    it.each([
      { clientId: '' },
      { clientId: 'a+b' },
      { code: '' },
      { code: 'has space' },
      { code: 'x'.repeat(MAX_CODE_CHARS + 1) },
      { redirectUri: 'https://bridge.test/callback?next=1' },
      { codeVerifier: PKCE_VALUE.toLowerCase() },
    ])('rejects invalid token inputs before request construction: %j', (change) => {
      expect(() => requests.token.build(input)).not.toThrow()
      expect(() => requests.token.build({ ...input, ...change })).toThrow('Invalid token request')
    })

    describe('token request', () => {
      it(
        tagged(
          'sends exactly its form to its endpoint and reveals it whole, committing only the bearer',
          tokenTags,
        ),
        () => {
          const request = requests.token.build(input)
          expect(request.url).toBe(fixture.tokenRequest.url)
          const body = text(request.body)
          expect([...new URLSearchParams(body)]).toEqual(fixture.tokenRequest.form(input))
          expect(body).toBe(new URLSearchParams(fixture.tokenRequest.form(input)).toString())
          if (input.clientCredential)
            expect(body).toContain('=public%26credential%3Dwith%2Bdelimiters%25')
          expect(text(request.headers['Content-Length'])).toBe(String(request.body.length))
          const sent = utf8(tokenSent(request))
          const received = httpResponse(evidence.tokenBody)
          const selected = token(tokenSent(request))
          expect(selected.bearer).toBe(evidence.bearer)
          expect(text(received.slice(selected.bearerRange.start, selected.bearerRange.end))).toBe(
            evidence.bearer,
          )
          const plan = planNotarization({ sent, received }, selected.ranges)
          expect(plan.reveal.sent).toEqual([{ start: 0, end: sent.length }])
          expect(plan.commit.sent).toEqual([])
          expect(plan.commit.received).toContainEqual({
            ...selected.bearerRange,
            algorithm: 'SHA256',
          })
        },
      )

      it(
        tagged('admits added headers and normalizes required names and HTTP whitespace', tokenTags),
        () => {
          const sent = tokenSent()
          for (const changed of [
            sent.replace('accept: application/json\r\n', '').replace('connection: close\r\n', ''),
            sent.replace(
              'accept: application/json',
              'accept: text/plain\r\naccept: application/json',
            ),
            sent.replace(`host: ${tokenUrl.host}`, `HOST \t:\t${tokenUrl.host} \t`),
            sent.replace('content-type: ', 'CONTENT_TYPE:\t'),
            sent.replace('accept:', 'x-extra: café 😀\r\nx-extra:\r\naccept:'),
          ]) {
            expect(changed).not.toBe(sent)
            const selected = token(changed)
            expect(selected.bearer).toBe(evidence.bearer)
            expect(selected.ranges.sent).toEqual([{ start: 0, end: utf8(changed).length }])
          }
        },
      )

      it.each([
        'Authorization: Basic other',
        'Cookie: session=other',
        'Content_Encoding: gzip',
        'Transfer-Encoding: chunked',
        'X_HTTP_Method_Override: POST',
        'X-Http-Method: POST',
        'X-Method-Override: POST',
      ])(tagged('rejects forbidden token header %s', tokenTags), (header) => {
        expect(() => token(tokenSent().replace('accept:', `${header}\r\naccept:`))).toThrow()
      })

      const host = `host: ${tokenUrl.host}`
      const length = requests.token.build(input).body.length
      it.each([
        [host, 'host: other.com'],
        ['application/x-www-form-urlencoded', 'text/plain'],
        [`${host}\r\n`, ''],
        [host, `${host}\r\nHOST: ${tokenUrl.host}`],
        ['content-type: ', 'content-type: application/x-www-form-urlencoded\r\ncontent_type: '],
        ['content-length: ', 'content-length: 3\r\ncontent_length: '],
        ['content-length: ', 'content-length: 000'],
        ['accept: application/json', 'accept: application/json\r\ntransfer-encoding: chunked'],
        [`content-length: ${length}`, `content-length: ${length - 1}`],
        ['content-length: ', 'content-length: +'],
        ['\r\nhost:', '\nhost:'],
        [`${host}\r\n`, `${host}\n\r\n`],
        ['\r\nhost:', '\r\n host:'],
        ['\r\nhost:', '\r\n\thost:'],
      ])(tagged('rejects altered framing: %j', tokenTags), (from, to) => {
        const sent = tokenSent()
        expect(sent).toContain(from)
        expect(() => token(sent.replace(from, to))).toThrow()
      })

      it.each(formChanges(text(requests.token.build(input).body), input.code))(
        tagged(
          'rejects an altered form despite a matching Content-Length: %s [TEST-COMMON-05] [TEST-COMMON-06]',
          tokenTags,
        ),
        (body) => {
          const request = requests.token.build(input)
          const altered = utf8(body)
          const headers = { ...request.headers, 'Content-Length': utf8(String(altered.length)) }
          expect(() => token(tokenSent({ ...request, body: altered, headers }))).toThrow()
        },
      )

      it.each(Object.keys(input) as (keyof TokenRequestInput)[])(
        tagged(
          'binds the complete request to the frozen %s [TEST-PLAT-09] [TEST-COMMON-11]',
          tokenTags,
        ),
        (field) => {
          const changed = { ...input, [field]: frozenChanges[field] }
          expect(() => requests.token.build(changed)).not.toThrow()
          expect(() => token(tokenSent(), evidence.tokenBody, changed)).toThrow(
            'Token request body changed',
          )
        },
      )

      if (input.clientCredential !== undefined)
        it.each(['', 'has space', 'trailing\n', '\tcredential', 'é', '\x7f'])(
          'rejects an invalid public credential %j before request construction',
          (clientCredential) => {
            expect(() => requests.token.build({ ...input, clientCredential })).toThrow()
          },
        )
    })

    describe('token response', () => {
      const bearing = (value: string) => evidence.tokenBody.replace(evidence.bearer, value)
      it.each([
        ['an empty bearer', bearing('')],
        ['a duplicated bearer', evidence.tokenBody.replace('{', '{ "access_token": "other",')],
        ['no bearer', evidence.tokenBody.replace('"access_token"', '"refresh_token"')],
        ['a bearer with a space', bearing('with space')],
        ['an over-length bearer', bearing('a'.repeat(MAX_BEARER_BYTES + 1))],
        [
          'a bearer that is not a JSON string',
          evidence.tokenBody.replace(`"${evidence.bearer}"`, `x${evidence.bearer}"`),
        ],
      ])('rejects a token response with %s', (_name, body) => {
        expect(() => token(tokenSent(), body)).toThrow()
      })

      it.each(jsonWhitespace)(
        'keeps the bearer framing exact around JSON whitespace %j [TEST-COMMON-10A]',
        (space) => {
          const body = spaced(evidence.tokenBody, space)
          const received = httpResponse(body)
          const selected = token(tokenSent(), body)
          expect(text(received.slice(selected.bearerRange.start, selected.bearerRange.end))).toBe(
            evidence.bearer,
          )
          expect(revealed(received, selected.ranges.received)).toEqual([
            `"access_token"${space}:${space}"`,
            '"',
          ])
        },
      )
    })

    describe('identity request', () => {
      const authorization = `authorization: Bearer ${evidence.bearer}`
      const bearerHoles = (sent: string) => identityOf(evidence.identityBody, sent).ranges.sent

      it(
        tagged(
          'pins exactly its headers and rejects each pinned one missing or duplicated',
          identityTags,
        ),
        () => {
          const request = requests.identity.build(evidence.bearer)
          expect(request.url).toBe(fixture.identityRequest.url)
          expect(
            Object.fromEntries(
              Object.entries(request.headers).map(([name, value]) => [name, text(value)]),
            ),
          ).toEqual({
            Host: identityUrl.host,
            Authorization: `Bearer ${evidence.bearer}`,
            ...fixture.identityRequest.headers,
            Connection: 'close',
          })
          for (const [name, value] of Object.entries(fixture.identityRequest.headers)) {
            const line = `${name.toLowerCase()}: ${value}\r\n`
            expect(identitySent).toContain(line)
            for (const replacement of ['', `${line}${line}`])
              expect(() =>
                identityOf(evidence.identityBody, identitySent.replace(line, replacement)),
              ).toThrow()
          }
        },
      )

      it('rejects whitespace in an HTTP bearer before sending', () => {
        for (const bearer of ['token token', ' token', 'token ', 'token\t', 'token\r\n'])
          expect(() => requests.identity.build(bearer)).toThrow('Invalid bearer')
      })

      it.each(['x-extra: value', 'x-extra: café 😀', 'x-extra:', 'x-extra:\tvalue'])(
        tagged(
          'reveals extra headers before and after Authorization without shifting its bearer: %s',
          identityTags,
        ),
        (extra) => {
          const sent = identitySent.replace(
            `${authorization}\r\n`,
            `${extra}\r\n${authorization}\r\n${extra}\r\n`,
          )
          const bytes = utf8(sent)
          const ranges = bearerHoles(sent)
          const plan = planNotarization(
            { sent: bytes, received: httpResponse(evidence.identityBody) },
            { sent: ranges, received: [] },
          )
          expect(plan.commit.sent).toHaveLength(1)
          const hole = plan.commit.sent[0]
          expect(text(bytes.slice(hole.start, hole.end))).toBe(evidence.bearer)
          expect(ranges).toEqual([
            { start: 0, end: hole.start },
            { start: hole.end, end: bytes.length },
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
      ])(
        tagged('rejects forbidden identity header %s [REQ-COMMON-39B]', identityTags),
        (header) => {
          expect(() => bearerHoles(identitySent.replace('host:', `${header}\r\nhost:`))).toThrow()
        },
      )

      const line = `GET ${identityUrl.pathname} HTTP/1.1`
      it.each([
        [authorization, `${authorization}\r\nAuthorization: Bearer ${evidence.bearer}`],
        [authorization, `${authorization}\r\nAuthorization: Basic other`],
        [authorization, 'authorization: Bearer other'],
        [`${authorization}\r\n`, ''],
        ['host: ', ' host: '],
        ['host: ', 'extra: x\nhost: '],
        ['host: ', 'extra: x\rhost: '],
        ['host: ', '\thost: '],
        ['host: ', 'extra: x\u0000\r\nhost: '],
        [line, line.replace(' HTTP', '?extra=1 HTTP')],
        ['\r\n\r\n', '\r\n\r\nbody'],
      ])(
        tagged('rejects ambiguous framing or changed required headers: %j', identityTags),
        (from, to) => {
          expect(identitySent).toContain(from)
          expect(() => bearerHoles(identitySent.replace(from, to))).toThrow()
        },
      )
    })

    describe('identity response', () => {
      it.each([
        ['its fixture', evidence.identityBody, evidence.identityMembers],
        ['the reordered', evidence.reorderedIdentityBody, evidence.reorderedIdentityMembers],
      ])(
        tagged('discloses exactly the two identity members of %s response', identityTags),
        (_name, body, expected) => {
          const selected = identityOf(body)
          expect(selected).toMatchObject({ userId: identity.userId, userName: identity.userName })
          expect(members(body)).toEqual(expected)
          const plan = planNotarization(
            { sent: utf8(identitySent), received: httpResponse(body) },
            selected.ranges,
          )
          expect(plan.commit.sent).toEqual([{ ...selected.bearerRange, algorithm: 'SHA256' }])
        },
      )

      it.each(jsonWhitespace)(
        tagged(
          'preserves JSON whitespace %j in its revealed members [TEST-COMMON-10A]',
          identityTags,
        ),
        (space) => {
          const body = spaced(evidence.identityBody, space)
          expect(identityOf(body)).toMatchObject({
            userId: identity.userId,
            userName: identity.userName,
          })
          expect(members(body)).toEqual(
            evidence.identityMembers.map((member) => spaced(member, space)),
          )
        },
      )

      it.each(['\v', '\f', '\u00a0'])(
        'rejects non-JSON whitespace %j around JSON members',
        (space) => {
          // Before the colon, and after it, where a value must begin.
          for (const [before, after] of [
            [space, ''],
            ['', space],
          ]) {
            expect(() => token(tokenSent(), spaced(evidence.tokenBody, before, after))).toThrow()
            expect(() => identityOf(spaced(evidence.identityBody, before, after))).toThrow()
          }
        },
      )

      it(
        tagged(
          'rejects a duplicated identity member, whatever its whitespace, and an incomplete one [TEST-COMMON-10]',
          identityTags,
        ),
        () => {
          const body = evidence.identityBody
          for (const member of evidence.identityMembers) {
            const name = member.match(/^"(\w+)"/)![1]
            expect(
              () => identityOf(body.replace(`"${name}"`, `"${name}" : "other", "${name}"`)),
              name,
            ).toThrow(/duplicated/)
            // Cut inside the member's value, and right after its colon.
            const at = body.indexOf(member)
            for (const end of [at + member.length - 2, at + member.indexOf(':') + 1])
              expect(() => identityOf(body.slice(0, end)), name).toThrow()
          }
        },
      )
    })
  })

  describe('results', () => {
    const { acceptResult } = ceremonyFor(platformId, 1)
    const createdAt = (time: bigint) => {
      const attestedData = LIBID_RS_ATTESTED_DATA.slice()
      new DataView(attestedData.buffer).setBigUint64(32, time)
      return { attestedData, signature: new Uint8Array(NOTARY_SIGNATURE_BYTES) }
    }
    const accept = (
      tokenAttestation: NotaryAttestation,
      identityAttestation = createdAt(1_770_000_000n),
    ) =>
      acceptResult(
        fixture.identity,
        { ...fixture.proof, tokenAttestation, identityAttestation },
        fixture.digest,
      )

    it('expiry uses only token attestation time and the launch lifetime [LIBID-OAUTH-012]', () => {
      const lifetime = proofLifetime[platformId]
      for (const [tokenTime, identityTime, expiresAt] of [
        [1_770_000_000, 1_770_000_100, 1_770_000_000 + lifetime],
        [1_770_000_000, 1_769_999_900, 1_770_000_000 + lifetime],
        [0, 0, lifetime],
        [Number.MAX_SAFE_INTEGER - lifetime, 0, Number.MAX_SAFE_INTEGER],
      ])
        expect(
          accept(createdAt(BigInt(tokenTime)), createdAt(BigInt(identityTime))).expiresAt,
        ).toBe(expiresAt)
    })

    it('rejects malformed token attestation bytes or unrepresentable expiry [LIBID-OAUTH-012]', () => {
      for (const tokenAttestation of [
        { attestedData: new Uint8Array([1]), signature: new Uint8Array(NOTARY_SIGNATURE_BYTES) },
        createdAt(BigInt(Number.MAX_SAFE_INTEGER - proofLifetime[platformId] + 1)),
        createdAt(0xffffffffffffffffn),
      ])
        expect(() => accept(tokenAttestation)).toThrow(
          /Invalid attested data|Proof expiry exceeds safe integer range/,
        )
    })
  })

  describe('composition', () => {
    it(
      tagged(
        'sends the code and the bearer only in notarized requests and never discloses the bearer [LIBID-MOD-013] [LIBID-OAUTH-015]',
        tags,
      ),
      async () => {
        // Only notary sessions carry HTTP; an ordinary fetch could leak the code or bearer.
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)
        const staged = stageNotarized(platformId, 'accepted')
        await (await proverOf(platformId)).prove(staged.context)
        expect(fetch).not.toHaveBeenCalled()
        const { transcripts, selected } = staged.notarized
        const { request } = staged.context
        const form = fixture.tokenRequest.form({
          clientId: request.clientId,
          code: returnSamples(platformId).accepted.credential,
          redirectUri: request.redirectUri,
          codeVerifier: request.codeVerifier!,
          clientCredential: request.clientCredential,
        })
        expect(text(transcripts[0].sent)).toContain(new URLSearchParams(form).toString())
        expect(text(transcripts[1].sent)).toContain(`Authorization: Bearer ${evidence.bearer}`)
        for (const [index, ranges] of selected.entries()) {
          const disclosed = [
            ...ranges.sent.map((r) => transcripts[index].sent.slice(r.start, r.end)),
            ...ranges.received.map((r) => transcripts[index].received.slice(r.start, r.end)),
          ]
          expect(disclosed.map(text).join('')).not.toContain(evidence.bearer)
        }
      },
    )

    it.each(['accepted', 'failed'])(
      tagged(
        'overlaps identity work with token openings and settles only on every output: %s [LIBID-PROVER-007] [LIBID-PROVER-013] [LIBID-PROVER-014] [TEST-PLAT-13] [LIBID-OAUTH-015]',
        tags,
      ),
      async (outcome) => {
        const staged = stageNotarized(platformId, 'accepted', { held: true })
        const { gates, log } = staged.notarized
        // A failed final attestation must not wait for proof generation.
        if (outcome === 'failed') generate.mockReturnValue(new Promise(() => {}))
        let settled = false
        const pending = (await proverOf(platformId)).prove(staged.context).finally(() => {
          settled = true
        })
        const checked =
          outcome === 'accepted'
            ? expect(pending).resolves.toMatchObject({ identity })
            : expect(pending).rejects.toMatchObject({
                event: 'token-attestation',
                message: 'Final attestation failed',
              })
        await vi.waitFor(() => expect(log).toEqual(['token send']))
        // Both sessions and the proof engine start before any HTTP; the engine first.
        expect(prepare.mock.calls).toEqual([
          [fixture.tokenRequest.url, { fetch: 'token-fetch', attestation: 'token-attestation' }],
          [
            fixture.identityRequest.url,
            { fetch: 'identity-fetch', attestation: 'identity-attestation' },
          ],
        ])
        expect(engine.mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[0])
        expect(notarization).toHaveBeenCalledWith(
          staged.context.request.notaryAddress,
          expect.any(AbortSignal),
          staged.context.emit,
        )
        // The identity request waits for the bearer, then overlaps the token openings.
        gates.tokenResponse.resolve()
        await vi.waitFor(() => expect(log).toContain('identity reveal'))
        expect(generate).not.toHaveBeenCalled()
        gates.tokenOpenings.resolve()
        await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
        expect(settled).toBe(false)
        if (outcome === 'accepted') gates.tokenAttestation.resolve()
        else gates.tokenAttestation.reject(new Error('Final attestation failed'))
        await checked
        // Settling retires both notary sessions and the proof engine.
        expect(notarization.mock.calls[0][1].aborted).toBe(true)
        expect(destroy).toHaveBeenCalledOnce()
      },
    )

    it.each(['closed', 'identity setup failed'])(
      tagged('retires both sessions and proving when %s during setup', tags),
      async (failure) => {
        const staged = stageNotarized(platformId, 'accepted')
        // Sessions stay in setup until the notary signal aborts; identity setup may fail first.
        const pending = () =>
          new Promise<never>((_, reject) => {
            const signal: AbortSignal = notarization.mock.calls[0][1]
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        const identitySetup = Promise.withResolvers<never>()
        prepare.mockImplementationOnce(pending).mockReturnValueOnce(identitySetup.promise)
        const result = (await proverOf(platformId)).prove(staged.context)
        const checked = expect(result).rejects.toMatchObject({
          event: failure === 'closed' ? 'token-fetch' : 'identity-fetch',
          message: failure,
        })
        await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
        if (failure === 'closed') staged.abort(new Error(failure))
        identitySetup.reject(new Error(failure))
        await checked
        expect(notarization.mock.calls[0][1].aborted).toBe(true)
        expect(generate).not.toHaveBeenCalled()
        expect(destroy).toHaveBeenCalledOnce()
      },
    )

    it(
      tagged('requires a notary address before notarization [LIBID-OAUTH-021]', tags),
      async () => {
        const staged = stageNotarized(platformId, 'accepted', {
          change: { request: { notaryAddress: null } },
        })
        await expect((await proverOf(platformId)).prove(staged.context)).rejects.toBeInstanceOf(
          Error,
        )
        expect(notarization).not.toHaveBeenCalled()
        expect(prepare).not.toHaveBeenCalled()
        expect(generate).not.toHaveBeenCalled()
      },
    )

    it.each(Object.keys(notarizedFailures) as (keyof typeof notarizedFailures)[])(
      tagged('rejects %s and destroys its engine', tags),
      async (outcome) => {
        const staged = stageNotarized(platformId, outcome)
        const pending = (await proverOf(platformId)).prove(staged.context)
        await expect(pending).rejects.toThrow(notarizedFailures[outcome])
        // Circuit-input construction attributes its own failures.
        if (outcome === 'opening-range')
          await expect(pending).rejects.toMatchObject({ event: 'circuit-inputs' })
        expect(destroy).toHaveBeenCalledOnce()
      },
    )
  })
})
