import { describe, expect, it, vi } from 'vitest'
import type { ProveIdentity } from '../../ccdp/index.js'
import { MAX_OAUTH_RETURN_CHARS } from '../../ccdp/limits.js'
import { type OAuthReturn, oauthState } from '../../ccdp/navigation.js'
import { CEREMONY_ID, fixtures, proveIdentity, returnSamples } from '../../testing/index.js'
import { platforms, supportedPlatforms } from '../index.js'
import {
  acceptReturn,
  MAX_FIELD_VALUE_CHARS,
  parseOAuthReturn,
  type ReturnRules,
} from '../oauthReturn.js'
import type { ReturnSamples } from './fixtures.js'
import {
  dropField,
  fieldsOf,
  PKCE_VALUE,
  returnOf,
  setField,
  sharedTextRejections,
  state,
  tagged,
  thrown,
} from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

const percentEncode = (value: string) =>
  [...value].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')

/** Provider metadata the return rules must ignore; each list is appended as extra fields. */
const metadata = [
  [],
  ['version_info='],
  ['version_info=synthetic%2Fmetadata%3D'],
  ['provider_meta=value', 'release.rev=1', 'new-field=', '1_debug=%E2%9C%93'],
  [
    'provider_meta=%E2%9C%93',
    'release.rev=1',
    'new-field=',
    '1_debug=value',
    'error_description=informational',
    'error_uri=',
  ],
  ['error_description=informational', 'error_uri=%2Fhelp'],
  // Over the bound encoded, within it decoded.
  [`meta=${'%2F'.repeat(MAX_FIELD_VALUE_CHARS / 2)}`],
]

/** Every return the rules must reject before exchange, each derived from the platform's samples. */
function malformedReturns(rules: ReturnRules, samples: ReturnSamples): [string, OAuthReturn][] {
  const accepted = fieldsOf(samples.accepted.oauthReturn, rules)
  const { credentialField } = rules
  const value = accepted.split('&').find((part) => part.startsWith(`${credentialField}=`))!
  const fields: [string, string][] = [
    [`duplicate ${credentialField}`, `${accepted}&${credentialField}=second`],
    ['duplicate state', `${accepted}&state=other`],
    ['percent-encoded state name', `${accepted}&%73tate=other`],
    [
      `percent-encoded ${credentialField} name`,
      accepted.replace(value, percentEncode(credentialField[0]) + value.slice(1)),
    ],
    ['success mixed with error', `${accepted}&error=access_denied`],
    ['missing state', dropField(accepted, 'state')],
    ['missing outcome', dropField(accepted, credentialField)],
    [`empty ${credentialField}`, setField(accepted, credentialField, '')],
    [`malformed ${credentialField} escape`, setField(accepted, credentialField, '%ZZ')],
    [`non-UTF-8 ${credentialField}`, setField(accepted, credentialField, '%FF')],
    [`control character ${credentialField}`, setField(accepted, credentialField, '%0A')],
    [`non-ASCII ${credentialField}`, setField(accepted, credentialField, '%E2%9C%93')],
    [`${credentialField} with a decoded control suffix`, accepted.replace(value, `${value}%0A`)],
    ['empty error', setField(fieldsOf(samples.error.oauthReturn, rules), 'error', '')],
    ...rules.rejected.map((name): [string, string] => [
      `leaked ${name}`,
      `${accepted}&${name}=unexpected`,
    ]),
    ['duplicate metadata', `${accepted}&provider_meta=one&provider_meta=two`],
    ['duplicate version_info', `${accepted}&version_info=one&version_info=two`],
    ['percent-encoded metadata name', `${accepted}&%76ersion_info=value`],
    ['malformed metadata escape', `${accepted}&provider_meta=%ZZ`],
    ['non-UTF-8 metadata', `${accepted}&provider_meta=%FF`],
    ['raw control character in metadata', `${accepted}&version_info=\n`],
    ['oversized metadata', `${accepted}&version_info=${'x'.repeat(MAX_FIELD_VALUE_CHARS + 1)}`],
    ['oversized decoded metadata', `${accepted}&meta=${'%2F'.repeat(MAX_FIELD_VALUE_CHARS + 1)}`],
    [
      'oversized return',
      accepted +
        Array.from(
          { length: MAX_OAUTH_RETURN_CHARS / MAX_FIELD_VALUE_CHARS + 1 },
          (_, i) => `&meta${i}=${'x'.repeat(MAX_FIELD_VALUE_CHARS)}`,
        ).join(''),
    ],
    ['metadata only', 'version_info=synthetic'],
    ['state and metadata only', `state=${state}&version_info=synthetic`],
    ['empty credential with metadata', `state=${state}&${credentialField}=&version_info=synthetic`],
  ]
  const other: ReturnRules = {
    ...rules,
    transport: rules.transport === 'query' ? 'fragment' : 'query',
  }
  return [
    ...fields.map(([name, value]): [string, OAuthReturn] => [name, returnOf(value, rules)]),
    ['the other transport', returnOf(accepted, other)],
    ['nonempty other transport', returnOf(accepted, rules, 'version_info=synthetic')],
    [
      `${credentialField} in the other transport`,
      returnOf(accepted, rules, `${credentialField}=other`),
    ],
    ['both transports', returnOf(accepted, rules, accepted)],
  ]
}

/** Issuer spellings issuer-bound rules must reject, as field suffixes. */
function issuerViolations(issuer: string): string[] {
  const { protocol, host, pathname } = new URL(issuer)
  const encoded = encodeURIComponent(issuer)
  return [
    '',
    `&iss=${issuer}&iss=${issuer}`,
    `&iss=${encoded}&iss=${encodeURIComponent('https://evil.test')}`,
    '&iss=%ZZ',
    '&iss=%FF',
    `&iss=${encodeURIComponent(encoded)}`,
    '&iss=https://other.test',
    `&iss=${protocol}//${host.toUpperCase()}${pathname}`,
    `&iss=${protocol}//${host}:443${pathname}`,
    `&iss=${issuer}/`,
    `&iss=${encoded}/`,
  ]
}

const outcomes = ['accepted', 'denied', 'error'] as const

describe.each(supportedPlatforms)('%s OAuth return', (platformId) => {
  const fixture = fixtures[platformId]
  // Returns are built and judged by the fixture's rules; only the parser reads the platform's own.
  const rules: ReturnRules = fixture.returnRules
  const version = platforms[platformId].versions[1]
  const production = version.returnRules
  const samples = returnSamples(platformId)
  const { returns: vectors, issuer: issuerVectors } = fixture.specTests
  const expected = {
    accepted: { outcome: 'accepted', state, credential: samples.accepted.credential },
    denied: { outcome: 'denied', state },
    error: { outcome: 'error', state, error: samples.error.error },
  }
  const admit = (
    request: Partial<ProveIdentity> = {},
    oauthReturn = samples.accepted.oauthReturn,
  ) =>
    acceptReturn(platformId, 1, proveIdentity(platformId, request), {
      ceremonyId: CEREMONY_ID,
      oauthReturn,
    })
  const accept = (oauthReturn: OAuthReturn) => admit({}, oauthReturn)?.credential ?? null
  const invalid = { event: 'authorization', message: 'Invalid OAuth return' }
  /** A return must parse and be admitted exactly like `outcome`'s sample. */
  function expectOutcome(oauthReturn: OAuthReturn, outcome: (typeof outcomes)[number]) {
    expect(parseOAuthReturn(oauthReturn, production)).toEqual(expected[outcome])
    if (outcome === 'accepted') expect(accept(oauthReturn)).toBe(samples.accepted.credential)
    else if (outcome === 'denied') expect(accept(oauthReturn)).toBeNull()
    else
      expect(thrown(() => accept(oauthReturn))).toMatchObject({
        event: 'authorization',
        message: 'Authorization failed',
      })
  }

  it.each(outcomes)('classifies its %s sample exactly [LIBID-OAUTH-018]', (outcome) => {
    expectOutcome(samples[outcome].oauthReturn, outcome)
  })

  it.each(outcomes)(
    'ignores provider metadata on the %s return without changing outcome, credential or issuer [LIBID-OAUTH-006] [LIBID-OAUTH-018]',
    (outcome) => {
      const fields = fieldsOf(samples[outcome].oauthReturn, rules)
      const present = fields.split('&').map((part) => part.split('=')[0])
      for (const extra of metadata) {
        const added = extra.filter((part) => !present.includes(part.split('=')[0]))
        expectOutcome(returnOf([fields, ...added].join('&'), rules), outcome)
      }
    },
  )

  it.each(outcomes)('binds the %s return to this ceremony state [LIBID-OAUTH-006]', (outcome) => {
    const fields = fieldsOf(samples[outcome].oauthReturn, rules)
    for (const other of [
      oauthState('00000000-0000-4000-8000-000000000000'),
      `v2.${CEREMONY_ID}`,
      CEREMONY_ID,
    ]) {
      const changed = returnOf(setField(fields, 'state', other), rules)
      expect(parseOAuthReturn(changed, production)).toMatchObject({ state: other })
      expect(thrown(() => accept(changed))).toMatchObject(invalid)
    }
  })

  it.each(outcomes)(
    tagged('applies its issuer rule to the %s return before exchange or denial', issuerVectors),
    (outcome) => {
      const fields = dropField(fieldsOf(samples[outcome].oauthReturn, rules), 'iss')
      const issuer = encodeURIComponent('https://issuer.test')
      if (rules.authorizationIssuer) {
        const encoded = encodeURIComponent(rules.authorizationIssuer)
        for (const iss of [rules.authorizationIssuer, encoded, encoded.toLowerCase()])
          expectOutcome(returnOf(`${fields}&iss=${iss}`, rules), outcome)
        for (const suffix of issuerViolations(rules.authorizationIssuer)) {
          expect(parseOAuthReturn(returnOf(fields + suffix, rules), production), suffix).toBeNull()
          expect(thrown(() => accept(returnOf(fields + suffix, rules)))).toMatchObject(invalid)
        }
        const other = setField(`${fields}&iss=${encoded}`, 'state', 'v1.other')
        expect(thrown(() => accept(returnOf(other, rules)))).toMatchObject(invalid)
      } else if (rules.rejected.includes('iss')) {
        expect(parseOAuthReturn(returnOf(`${fields}&iss=${issuer}`, rules), production)).toBeNull()
        expect(thrown(() => accept(returnOf(`${fields}&iss=${issuer}`, rules)))).toMatchObject(
          invalid,
        )
      } else expectOutcome(returnOf(`${fields}&iss=${issuer}`, rules), outcome)
    },
  )

  it.each(malformedReturns(rules, samples))(
    tagged('rejects %s before exchange [LIBID-OAUTH-007]', vectors),
    (_name, oauthReturn) => {
      expect(parseOAuthReturn(oauthReturn, production)).toBeNull()
      expect(thrown(() => accept(oauthReturn))).toMatchObject(invalid)
    },
  )

  it('decodes each value exactly once under the decoded bounds', () => {
    const fields = fieldsOf(samples.accepted.oauthReturn, rules)
    const { credential } = samples.accepted
    for (const [raw, decoded] of [
      [percentEncode(credential), credential],
      ['a%2Bb%2fc', 'a+b/c'],
      ['%252F', '%2F'],
    ]) {
      const changed = returnOf(setField(fields, rules.credentialField, raw), rules)
      expect(parseOAuthReturn(changed, production)).toEqual({
        ...expected.accepted,
        credential: decoded,
      })
      expect(accept(changed)).toBe(decoded)
    }
    // Plus signs decode to spaces, and the bound applies to decoded values.
    const errors = fieldsOf(samples.error.oauthReturn, rules)
    for (const [raw, decoded] of [
      ['a+b%20c%2fd', 'a b c/d'],
      ['%2F'.repeat(MAX_FIELD_VALUE_CHARS / 2), '/'.repeat(MAX_FIELD_VALUE_CHARS / 2)],
    ]) {
      const changed = returnOf(setField(errors, 'error', raw), rules)
      expect(parseOAuthReturn(changed, production)).toEqual({ ...expected.error, error: decoded })
    }
  })

  it('admits the code verifier exactly where the catalog declares PKCE, and the client [LIBID-OAUTH-021]', () => {
    expect(admit()).toEqual({
      credential: samples.accepted.credential,
      codeVerifier: version.pkce ? PKCE_VALUE : null,
    })
    for (const request of [
      { codeVerifier: version.pkce ? null : PKCE_VALUE },
      { clientId: sharedTextRejections[1] },
    ])
      expect(thrown(() => admit(request))).toMatchObject({ event: 'authorization' })
  })

  it('requires a valid public credential before exchange exactly when the catalog does [LIBID-MOD-013]', () => {
    const request = proveIdentity(platformId)
    delete request.clientCredential
    const missing = () =>
      acceptReturn(platformId, 1, request, {
        ceremonyId: CEREMONY_ID,
        oauthReturn: samples.accepted.oauthReturn,
      })
    if (platforms[platformId].requiresClientCredential) {
      expect(thrown(missing)).toMatchObject({ event: 'token-fetch' })
      expect(thrown(() => admit({ clientCredential: 'has space' }))).toMatchObject({
        event: 'token-fetch',
      })
    } else expect(missing()?.credential).toBe(samples.accepted.credential)
  })
})
