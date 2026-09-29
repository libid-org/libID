import { expect, it } from 'vitest'
import { oauthReturn as github } from './github/1/url.js'
import { oauthReturn as google } from './google/1/url.js'
import { parseOAuthReturn } from './oauthReturn.js'
import { oauthReturn as x } from './x/1/url.js'

const parse = (query: string, profile = github) =>
  parseOAuthReturn({ query, fragment: '' }, profile)

const iss = '&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth'

it('accepts GitHub success and detailed denial/error returns [LIBID-OAUTH-018]', () => {
  expect(parse(`?code=test&state=v1.test${iss}`)).toEqual({
    outcome: 'accepted',
    state: 'v1.test',
    credential: 'test',
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
  expect(parse('?code=test&state=v1.test', x)).toMatchObject({ outcome: 'accepted' })
})

it('decodes equivalent valid form encodings exactly once', () => {
  expect(parse(`?code=a%2fb%20c&state=v1.test${iss.toLowerCase()}`)).toMatchObject({
    credential: 'a/b c',
  })
  expect(parse(`?code=${'%2F'.repeat(4096)}&state=v1.test${iss}`)).toMatchObject({
    credential: '/'.repeat(4096),
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

it('does not accept issuer fields for X or mixed query/fragment returns [TEST-PLAT-18]', () => {
  expect(parse(`?code=test&state=v1.test${iss}`, x)).toBeNull()
  expect(
    parseOAuthReturn({ query: `?code=test&state=v1.test${iss}`, fragment: '#code=other' }, github),
  ).toBeNull()
})

it('ignores new X/GitHub metadata without changing outcome, code or issuer [LIBID-OAUTH-006] [LIBID-OAUTH-018]', () => {
  for (const profile of [x, github]) {
    const suffix = profile.issuer ? iss : ''
    for (const [query, expected] of [
      ['?code=test&state=v1.test', { outcome: 'accepted', state: 'v1.test', credential: 'test' }],
      ['?error=access_denied&state=v1.test', { outcome: 'denied', state: 'v1.test' }],
      [
        '?error=server_error&state=v1.test',
        { outcome: 'error', state: 'v1.test', error: 'server_error' },
      ],
    ] as const) {
      expect(
        parse(
          query +
            suffix +
            '&provider_meta=%E2%9C%93&release.rev=1&new-field=&1_debug=value&error_description=informational&error_uri=',
          profile,
        ),
      ).toEqual(expected)
    }
  }
})

const state = 'v1.123e4567-e89b-42d3-a456-426614174000'

const accepted = `#state=${state}&id_token=header.payload.signature`

const parseGoogle = (fragment: string, query = '') => parseOAuthReturn({ query, fragment }, google)

it('ignores Google metadata without changing the outcome or credential [LIBID-OAUTH-006]', () => {
  for (const [fragment, expected] of [
    [accepted, { outcome: 'accepted', state, credential: 'header.payload.signature' }],
    [`#state=${state}&error=access_denied`, { outcome: 'denied', state }],
    [`#state=${state}&error=server_error`, { outcome: 'error', state, error: 'server_error' }],
  ] as const) {
    for (const metadata of [
      '',
      '&version_info=',
      '&version_info=synthetic%2Fmetadata%3D',
      '&provider_meta=value&release.rev=1&new-field=&1_debug=%E2%9C%93',
      '&error_description=informational&error_uri=%2Fhelp',
    ]) {
      expect(parseGoogle(fragment + metadata)).toEqual(expected)
    }
  }
})

it('keeps ambiguous, malformed and credential-bearing extras rejected [LIBID-OAUTH-007] [TEST-PLAT-03]', () => {
  for (const extra of [
    '&version_info=one&version_info=two',
    '&%76ersion_info=value',
    `&version_info=${'x'.repeat(8193)}`,
    '&version_info=\n',
    '&state=other',
    '&id_token=other',
    '&error=access_denied',
    '&code=unexpected',
    '&access_token=unexpected',
    '&refresh_token=unexpected',
    '&provider_meta=one&provider_meta=two',
    '&provider_meta=%ZZ',
    '&provider_meta=%FF',
    '&%73tate=other',
  ]) {
    expect(parseGoogle(accepted + extra)).toBeNull()
  }
})

it('does not let version_info supply missing evidence or change transport [LIBID-OAUTH-007] [TEST-PLAT-05]', () => {
  for (const fragment of [
    '#version_info=synthetic',
    `#state=${state}&version_info=synthetic`,
    `#state=${state}&id_token=&version_info=synthetic`,
  ]) {
    expect(parseGoogle(fragment)).toBeNull()
  }
  expect(parseGoogle(accepted, '?version_info=synthetic')).toBeNull()
  expect(parseGoogle('', `?state=${state}&id_token=synthetic&version_info=synthetic`)).toBeNull()
})

it('decodes Google fragment values once under the same decoded bounds', () => {
  expect(
    parseGoogle(`#state=${state}&id_token=header%2Epayload.signature&meta=${'%2F'.repeat(4096)}`),
  ).toEqual({ outcome: 'accepted', state, credential: 'header.payload.signature' })
  for (const fragment of [
    `#state=${state}&id_token=header.payload%0A`,
    `#state=${state}&id_token=%E2%9C%93`,
    `#state=${state}&id_token=header.payload.signature&meta=${'%2F'.repeat(8193)}`,
  ])
    expect(parseGoogle(fragment)).toBeNull()
})
