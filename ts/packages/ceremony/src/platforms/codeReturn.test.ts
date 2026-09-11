import { expect, it } from 'vitest'
import { parseCodeOAuthReturn } from './codeReturn.js'

const issuer = 'https://github.com/login/oauth'

const parse = (query: string, expectedIssuer: string | undefined = issuer) =>
  parseCodeOAuthReturn({ query, fragment: '' }, expectedIssuer)

const iss = '&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth'

it('accepts GitHub success and detailed denial/error returns [LIBID-OAUTH-018]', () => {
  expect(parse(`?code=test&state=v1.test${iss}`)).toEqual({
    outcome: 'accepted',
    state: 'v1.test',
    code: 'test',
  })
  expect(
    parse(
      `?error=access_denied&error_description=Access+denied&error_uri=%2Fhelp&state=v1.test${iss}`,
    ),
  ).toEqual({ outcome: 'denied', state: 'v1.test' })
  expect(parse(`?error=application_suspended&state=v1.test${iss}`)).toEqual({
    outcome: 'error',
    state: 'v1.test',
    error: 'application_suspended',
  })
  expect(parseCodeOAuthReturn({ query: '?code=test&state=v1.test', fragment: '' })).toMatchObject({
    outcome: 'accepted',
  })
})

it('decodes equivalent valid form encodings exactly once', () => {
  expect(parse(`?code=a%2fb%20c&state=v1.test${iss.toLowerCase()}`)).toMatchObject({
    code: 'a/b c',
  })
  expect(parse(`?code=${'%2F'.repeat(4096)}&state=v1.test${iss}`)).toMatchObject({
    code: '/'.repeat(4096),
  })
})

it.each([
  '?code=test&state=v1.test',
  `?code=test&state=v1.test${iss}/`,
  `?code=test&state=v1.test${iss}&iss=https%3A%2F%2Fevil.test`,
  `?code=test&code=second&state=v1.test${iss}`,
  `?code=test&state=v1.test&error=access_denied${iss}`,
  `?code=%ZZ&state=v1.test${iss}`,
  `?code=%FF&state=v1.test${iss}`,
  `?code=%0A&state=v1.test${iss}`,
  `?%63ode=test&state=v1.test${iss}`,
  `?code=&state=v1.test${iss}`,
  `?error=&state=v1.test${iss}`,
  `?code=test&state=v1.test&id_token=unexpected${iss}`,
  `?code=test&state=v1.test&access_token=unexpected${iss}`,
  `?code=test&state=v1.test&refresh_token=unexpected${iss}`,
  `?code=test&state=v1.test&provider_meta=one&provider_meta=two${iss}`,
  `?code=test&state=v1.test&provider_meta=%ZZ${iss}`,
  `?code=test&state=v1.test&provider_meta=%FF${iss}`,
  `?code=test&state=v1.test&provider_meta=${'x'.repeat(8193)}${iss}`,
])('rejects ambiguous or invalid GitHub return: %s', (query) => {
  expect(parse(query)).toBeNull()
})

it('does not accept issuer fields for X or mixed query/fragment returns', () => {
  expect(parseCodeOAuthReturn({ query: `?code=test&state=v1.test${iss}`, fragment: '' })).toBeNull()
  expect(
    parseCodeOAuthReturn(
      { query: `?code=test&state=v1.test${iss}`, fragment: '#code=other' },
      issuer,
    ),
  ).toBeNull()
})

it('ignores new X/GitHub metadata without changing outcome, code or issuer [LIBID-OAUTH-006] [LIBID-OAUTH-018]', () => {
  for (const expectedIssuer of [undefined, issuer]) {
    const suffix = expectedIssuer ? iss : ''
    for (const [query, expected] of [
      ['?code=test&state=v1.test', { outcome: 'accepted', state: 'v1.test', code: 'test' }],
      ['?error=access_denied&state=v1.test', { outcome: 'denied', state: 'v1.test' }],
      [
        '?error=server_error&state=v1.test',
        { outcome: 'error', state: 'v1.test', error: 'server_error' },
      ],
    ] as const) {
      expect(
        parseCodeOAuthReturn(
          {
            query:
              query +
              suffix +
              '&provider_meta=%E2%9C%93&release.rev=1&new-field=&1_debug=value&error_description=informational&error_uri=',
            fragment: '',
          },
          expectedIssuer,
        ),
      ).toEqual(expected)
    }
  }
})
