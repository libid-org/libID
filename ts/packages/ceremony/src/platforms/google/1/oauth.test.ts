import { expect, it } from 'vitest'
import { parseOAuthReturn } from './oauth.js'

const state = 'v1.123e4567-e89b-42d3-a456-426614174000'
const accepted = `#state=${state}&id_token=header.payload.signature`
const parse = (fragment: string, query = '') => parseOAuthReturn({ query, fragment })

it('ignores Google metadata without changing the outcome or credential [LIBID-OAUTH-006]', () => {
  for (const [fragment, expected] of [
    [accepted, { outcome: 'accepted', state, idToken: 'header.payload.signature' }],
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
      expect(parse(fragment + metadata)).toEqual(expected)
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
    expect(parse(accepted + extra)).toBeNull()
  }
})

it('does not let version_info supply missing evidence or change transport [LIBID-OAUTH-007]', () => {
  for (const fragment of [
    '#version_info=synthetic',
    `#state=${state}&version_info=synthetic`,
    `#state=${state}&id_token=&version_info=synthetic`,
  ]) {
    expect(parse(fragment)).toBeNull()
  }
  expect(parse(accepted, '?version_info=synthetic')).toBeNull()
  expect(parse('', `?state=${state}&id_token=synthetic&version_info=synthetic`)).toBeNull()
})
