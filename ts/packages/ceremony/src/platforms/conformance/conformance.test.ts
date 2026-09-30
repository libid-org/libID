// Catalog-driven platform conformance: every section iterates the catalog and reads the typed
// fixture table, so a new platform is covered as soon as its fixture entry typechecks.
import { sha256 } from '@noble/hashes/sha2.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Asset, assetUrl } from '../../assets/index.js'
import { proofAssets } from '../../barretenberg/barretenberg.assets.js'
import type { ProofEngineOptions, RawProof } from '../../barretenberg/engine.js'
import { proofEvents, proofWeights } from '../../barretenberg/events.js'
import { validateCeremonyConfig } from '../../ccdp/client/config.js'
import { type OAuthReturn, oauthState } from '../../ccdp/navigation.js'
import { isCoreEvent, type OperationEvent } from '../../events.js'
import type { NotaryAttestation } from '../../notary/decode.js'
import { concat, encodeAttestation, opening } from '../../notary/fixtures/attestation.js'
import { LIBID_RS_ATTESTED_DATA } from '../../notary/fixtures/libid-rs.js'
import { correlateReveal, planNotarization, verifyAttestation } from '../../notary/notarize.js'
import { notaryAssets } from '../../notary/notary.assets.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  Reveals,
  Transcript,
} from '../../notary/protocol.js'
import { b64urlEncode } from '../../primitives.js'
import {
  type BearerLinkPlatform,
  bearerLinkPlatforms,
  CEREMONY_ID,
  fixtures,
  httpResponse,
  jwtPart,
  jwtWith,
  type OidcPlatform,
  oidcPlatforms,
  platformConfig,
  proverContext,
  proverRequest,
  returnSamples,
  text,
  utf8,
} from '../../testing/index.js'
import { deriveCodeChallenge, deriveCodeVerifier } from '../authorization.js'
import type { BearerTranscript, TokenRequestInput } from '../bearer-transcript.js'
import type { ProverContext } from '../context.js'
import type { IdentityResult, OAuthProof, ProofByPlatformVersion } from '../index.js'
import {
  assembleResult,
  commonVersions,
  implementationFor,
  isPlatformId,
  type PlatformId,
  platforms,
  supportedPlatforms,
} from '../index.js'
import { acceptReturn, parseOAuthReturn, type ReturnProfile } from '../oauthReturn.js'
import { assetsByPlatform, circuits } from '../platforms.assets.js'
import type { EvidenceChange, PlatformFixture, ReturnSamples } from './fixtures.js'

const { prepare, generate, destroy, engine, notarization } = vi.hoisted(() => ({
  prepare: vi.fn(),
  generate: vi.fn(),
  destroy: vi.fn(),
  engine: vi.fn(),
  notarization: vi.fn(),
}))
// One distinct URL per resource, so tests can see which resources a pipeline proves with.
vi.mock('../../assets/index.js', async (original) => {
  const urls = new Map<object, string>()
  return {
    ...(await original<typeof import('../../assets/index.js')>()),
    assetUrl: (asset: object) => {
      if (!urls.has(asset)) urls.set(asset, `https://ccdp.test/asset/${urls.size}`)
      return urls.get(asset)
    },
  }
})
// Only the external TLSN runtime and the expensive proof engine are replaced.
vi.mock('../../barretenberg/engine.js', () => ({
  ProofEngine: class {
    constructor(options: ProofEngineOptions) {
      engine(options)
      options.emit?.({ event: 'zk-proof-preparation', phase: 'started', timestamp: 0 })
    }
    prove = generate
    destroy = destroy
  },
}))
vi.mock('../../notary/session.js', () => ({
  Notarization: class {
    constructor(address: string, signal: AbortSignal, emit: unknown) {
      notarization(address, signal, emit)
      signal.throwIfAborted()
    }
    prepare = prepare
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const state = oauthState(CEREMONY_ID)

/** Text every identity string field and client ID rejects on every platform. */
const sharedTextRejections = ['', 'a"b', 'é', 'a\nb', 'a\x7fb']

const overLength = (longest: string) => longest + longest.at(-1)

/** A title followed by any requirement tags. */
const tagged = (title: string, tags: string) => [title, tags].filter(Boolean).join(' ')

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('Expected a failure')
}

/** Nothing past return admission ran: no network, notary session or proof engine. */
function expectNoProvingWork(fetch: unknown = globalThis.fetch) {
  expect(fetch).not.toHaveBeenCalled()
  expect(notarization).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
  expect(engine).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
}

/** Resources a pipeline's proof engine loaded must belong to the platform's asset set. */
function expectEngineAssets(platformId: PlatformId) {
  const assets: readonly Asset[] = assetsByPlatform[platformId][1]
  const urls = assets.map(assetUrl)
  expect(engine).toHaveBeenCalledOnce()
  const [{ circuitUrl, verificationKeyUrl }] = engine.mock.calls[0] as [ProofEngineOptions]
  expect(circuits.map(assetUrl)).toContain(circuitUrl)
  expect(urls).toContain(circuitUrl)
  expect(urls).toContain(verificationKeyUrl)
  expect(verificationKeyUrl).not.toBe(circuitUrl)
}

it('covers exactly the catalog platforms', () => {
  expect(Object.keys(fixtures)).toEqual([...supportedPlatforms])
  expect(Object.keys(assetsByPlatform)).toEqual([...supportedPlatforms])
  expect([...bearerLinkPlatforms, ...oidcPlatforms].sort()).toEqual([...supportedPlatforms].sort())
})

describe.each(supportedPlatforms)('%s catalog contract', (platformId) => {
  const fixture = fixtures[platformId]
  const platform = platforms[platformId]
  const implementation = implementationFor(platformId, 1)

  it('exposes exactly the members Client, Prover and the asset build consume', () => {
    expect(isPlatformId(platformId)).toBe(true)
    expect(Object.keys(platform).sort()).toEqual([
      'isClientId',
      'requiresClientCredential',
      'versions',
    ])
    expect(typeof platform.requiresClientCredential).toBe('boolean')
    expect(Object.keys(platform.versions)).toEqual(['1'])
    expect(commonVersions(platformId, [0, 2, 1])).toEqual([1])
    expect(() => implementationFor(platformId, 2 as 1)).toThrow('Unsupported platform version')
    expect(Object.keys(implementation).sort()).toEqual([
      'acceptResult',
      'buildAuthorizationUrl',
      'events',
      'oauthReturn',
      'pkce',
      'progressWeights',
    ])
    // Code exchange binds the digest through PKCE; an implicit ID token carries it as the nonce.
    expect(implementation.pkce).toBe(fixture.pipeline === 'bearer-link')
  })

  it('round-trips client, redirect, state and the digest binding through its authorization URL', () => {
    const digest = new Uint8Array(32).fill(7)
    const codeVerifier = deriveCodeVerifier(digest, new Uint8Array(32).fill(9))
    const input = {
      clientId: fixture.config.clientId,
      redirectUri: 'https://bridge.test/auth/callback',
      state,
      authorizationDigest: digest,
      codeChallenge: implementation.pkce ? deriveCodeChallenge(codeVerifier) : null,
    }
    const url = new URL(implementation.buildAuthorizationUrl(input))
    const params = url.searchParams
    expect(url.protocol).toBe('https:')
    expect(url.hash).toBe('')
    expect(url.search.slice(1)).toBe(params.toString())
    expect(new Set(params.keys()).size).toBe([...params.keys()].length)
    expect(params.get('client_id')).toBe(input.clientId)
    expect(params.get('redirect_uri')).toBe(input.redirectUri)
    expect(params.get('state')).toBe(state)
    // The requested response is exactly what the platform's return rules accept.
    expect(params.get('response_type') ?? 'code').toBe(fixture.oauthReturn.credential)
    expect(params.get('response_mode') ?? 'query').toBe(fixture.oauthReturn.transport)
    if (implementation.pkce) {
      expect(params.get('code_challenge')).toBe(input.codeChallenge)
      expect(params.get('code_challenge_method')).toBe('S256')
      expect(params.has('nonce')).toBe(false)
    } else {
      expect(params.get('nonce')).toBe(b64urlEncode(digest))
      expect(params.has('code_challenge')).toBe(false)
    }
    const malformed = {
      ...input,
      authorizationDigest: digest.slice(1),
      codeChallenge: implementation.pkce ? codeVerifier.slice(1) : null,
    }
    expect(() => implementation.buildAuthorizationUrl(malformed)).toThrow()
  })

  const validate = (entry: unknown) =>
    validateCeremonyConfig(
      { ccdpOrigin: 'https://ccdp.test', platforms: { [platformId]: entry } },
      'https://bridge.test',
    ).platforms[platformId]

  it('admits its fixture, boundary and admitted client IDs and rejects empty, quoted, control, non-ASCII, over-length and platform-reserved ones, as a predicate and in configuration [TEST-COMMON-09]', () => {
    const { config, identity, longest, rejectedIdentity, admittedClientIds } = fixture
    expect(identity.oauthClientId).toBe(config.clientId)
    for (const clientId of [config.clientId, longest.oauthClientId, ...admittedClientIds]) {
      expect(platform.isClientId(clientId), clientId).toBe(true)
      expect(validate({ ...platformConfig(platformId), clientId })).toMatchObject({ clientId })
    }
    for (const clientId of [
      ...sharedTextRejections,
      overLength(longest.oauthClientId),
      ...rejectedIdentity.oauthClientId,
    ]) {
      expect(platform.isClientId(clientId), clientId).toBe(false)
      expect(() => validate({ ...platformConfig(platformId), clientId }), clientId).toThrow()
    }
    for (const clientId of [42, null]) expect(platform.isClientId(clientId)).toBe(false)
  })

  it('requires a valid public token-exchange credential in configuration exactly when the catalog does', () => {
    const { clientCredential, ...withoutCredential } = platformConfig(platformId)
    expect(validate(platformConfig(platformId))).toEqual(platformConfig(platformId))
    if (platform.requiresClientCredential) {
      expect(clientCredential).toBeDefined()
      expect(() => validate(withoutCredential)).toThrow()
    } else
      expect(validate({ ...withoutCredential, clientCredential: 'public-fixture' })).toMatchObject({
        clientCredential: 'public-fixture',
      })
    for (const clientCredential of ['', 'has space', 'é', 'a\nb', 'x'.repeat(513)])
      expect(() => validate({ ...withoutCredential, clientCredential })).toThrow()
  })

  it('weights every pipeline operation once and ships its proof and pipeline resources', () => {
    const { events, progressWeights } = implementation
    expect(Object.keys(progressWeights).sort()).toEqual(
      [...Object.keys(proofWeights), ...fixture.operations].sort(),
    )
    for (const weight of Object.values(progressWeights))
      expect(Number.isInteger(weight) && weight > 0).toBe(true)
    expect(events).toEqual(expect.arrayContaining([...proofEvents]))
    for (const event of events) expect(isCoreEvent(event)).toBe(true)
    const assets: readonly Asset[] = assetsByPlatform[platformId][1]
    const pipelineAssets = fixture.pipeline === 'bearer-link' ? notaryAssets : []
    expect(assets).toEqual(expect.arrayContaining([...proofAssets, ...pipelineAssets]))
    expect(circuits.filter((circuit) => assets.includes(circuit))).toHaveLength(1)
  })
})

// Return helpers over one profile: `fields` is the component without its `?`/`#` prefix.
const fieldsOf = (value: OAuthReturn, profile: ReturnProfile) =>
  (profile.transport === 'query' ? value.query : value.fragment).slice(1)

function returnOf(fields: string, profile: ReturnProfile, other = ''): OAuthReturn {
  return profile.transport === 'query'
    ? { query: `?${fields}`, fragment: other && `#${other}` }
    : { query: other && `?${other}`, fragment: `#${fields}` }
}

const setField = (fields: string, name: string, raw: string) =>
  fields
    .split('&')
    .map((part) => (part.startsWith(`${name}=`) ? `${name}=${raw}` : part))
    .join('&')

const dropField = (fields: string, name: string) =>
  fields
    .split('&')
    .filter((part) => !part.startsWith(`${name}=`))
    .join('&')

const percentEncode = (value: string) =>
  [...value].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')

/** Provider metadata a profile must ignore; each list is appended as extra fields. */
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
  [`meta=${'%2F'.repeat(4096)}`],
]

/** Every return a profile must reject before exchange, each derived from the platform's samples. */
function malformedReturns(profile: ReturnProfile, samples: ReturnSamples): [string, OAuthReturn][] {
  const accepted = fieldsOf(samples.accepted.oauthReturn, profile)
  const { credential } = profile
  const value = accepted.split('&').find((part) => part.startsWith(`${credential}=`))!
  const fields: [string, string][] = [
    [`duplicate ${credential}`, `${accepted}&${credential}=second`],
    ['duplicate state', `${accepted}&state=other`],
    ['percent-encoded state name', `${accepted}&%73tate=other`],
    [
      `percent-encoded ${credential} name`,
      accepted.replace(value, percentEncode(credential[0]) + value.slice(1)),
    ],
    ['success mixed with error', `${accepted}&error=access_denied`],
    ['missing state', dropField(accepted, 'state')],
    ['missing outcome', dropField(accepted, credential)],
    [`empty ${credential}`, setField(accepted, credential, '')],
    [`malformed ${credential} escape`, setField(accepted, credential, '%ZZ')],
    [`non-UTF-8 ${credential}`, setField(accepted, credential, '%FF')],
    [`control character ${credential}`, setField(accepted, credential, '%0A')],
    [`non-ASCII ${credential}`, setField(accepted, credential, '%E2%9C%93')],
    [`${credential} with a decoded control suffix`, accepted.replace(value, `${value}%0A`)],
    ['empty error', setField(fieldsOf(samples.error.oauthReturn, profile), 'error', '')],
    ...profile.rejected.map((name): [string, string] => [
      `leaked ${name}`,
      `${accepted}&${name}=unexpected`,
    ]),
    ['duplicate metadata', `${accepted}&provider_meta=one&provider_meta=two`],
    ['duplicate version_info', `${accepted}&version_info=one&version_info=two`],
    ['percent-encoded metadata name', `${accepted}&%76ersion_info=value`],
    ['malformed metadata escape', `${accepted}&provider_meta=%ZZ`],
    ['non-UTF-8 metadata', `${accepted}&provider_meta=%FF`],
    ['raw control character in metadata', `${accepted}&version_info=\n`],
    ['oversized metadata', `${accepted}&version_info=${'x'.repeat(8193)}`],
    ['oversized decoded metadata', `${accepted}&meta=${'%2F'.repeat(8193)}`],
    [
      'oversized return',
      accepted + Array.from({ length: 5 }, (_, i) => `&meta${i}=${'x'.repeat(8000)}`).join(''),
    ],
    ['metadata only', 'version_info=synthetic'],
    ['state and metadata only', `state=${state}&version_info=synthetic`],
    ['empty credential with metadata', `state=${state}&${credential}=&version_info=synthetic`],
  ]
  const other: ReturnProfile = {
    ...profile,
    transport: profile.transport === 'query' ? 'fragment' : 'query',
  }
  return [
    ...fields.map(([name, value]): [string, OAuthReturn] => [name, returnOf(value, profile)]),
    ['the other transport', returnOf(accepted, other)],
    ['nonempty other transport', returnOf(accepted, profile, 'version_info=synthetic')],
    [`${credential} in the other transport`, returnOf(accepted, profile, `${credential}=other`)],
    ['both transports', returnOf(accepted, profile, accepted)],
  ]
}

/** Issuer spellings an issuer-bound profile must reject, as field suffixes. */
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
  // Returns are built and judged by the fixture's rules; only the parser reads the profile.
  const profile: ReturnProfile = fixture.oauthReturn
  const version = platforms[platformId].versions[1]
  const production = version.oauthReturn
  const samples = returnSamples(platformId)
  const { returns: vectors, issuer: issuerVectors } = fixture.specTests
  const expected = {
    accepted: { outcome: 'accepted', state, credential: samples.accepted.credential },
    denied: { outcome: 'denied', state },
    error: { outcome: 'error', state, error: samples.error.error },
  }
  const accept = (oauthReturn: OAuthReturn) =>
    acceptReturn(proverContext(platformId, { oauthReturn }), platformId)
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
      const fields = fieldsOf(samples[outcome].oauthReturn, profile)
      const present = fields.split('&').map((part) => part.split('=')[0])
      for (const extra of metadata) {
        const added = extra.filter((part) => !present.includes(part.split('=')[0]))
        expectOutcome(returnOf([fields, ...added].join('&'), profile), outcome)
      }
    },
  )

  it.each(outcomes)('binds the %s return to this ceremony state [LIBID-OAUTH-006]', (outcome) => {
    const fields = fieldsOf(samples[outcome].oauthReturn, profile)
    for (const other of [
      oauthState('00000000-0000-4000-8000-000000000000'),
      `v2.${CEREMONY_ID}`,
      CEREMONY_ID,
    ]) {
      const changed = returnOf(setField(fields, 'state', other), profile)
      expect(parseOAuthReturn(changed, production)).toMatchObject({ state: other })
      expect(thrown(() => accept(changed))).toMatchObject(invalid)
    }
  })

  it.each(outcomes)(
    tagged('applies its issuer rule to the %s return before exchange or denial', issuerVectors),
    (outcome) => {
      const fields = dropField(fieldsOf(samples[outcome].oauthReturn, profile), 'iss')
      const issuer = encodeURIComponent('https://issuer.test')
      if (profile.issuer) {
        const encoded = encodeURIComponent(profile.issuer)
        for (const iss of [profile.issuer, encoded, encoded.toLowerCase()])
          expectOutcome(returnOf(`${fields}&iss=${iss}`, profile), outcome)
        for (const suffix of issuerViolations(profile.issuer)) {
          expect(
            parseOAuthReturn(returnOf(fields + suffix, profile), production),
            suffix,
          ).toBeNull()
          expect(thrown(() => accept(returnOf(fields + suffix, profile)))).toMatchObject(invalid)
        }
        const other = setField(`${fields}&iss=${encoded}`, 'state', 'v1.other')
        expect(thrown(() => accept(returnOf(other, profile)))).toMatchObject(invalid)
      } else if (profile.rejected.includes('iss')) {
        expect(
          parseOAuthReturn(returnOf(`${fields}&iss=${issuer}`, profile), production),
        ).toBeNull()
        expect(thrown(() => accept(returnOf(`${fields}&iss=${issuer}`, profile)))).toMatchObject(
          invalid,
        )
      } else expectOutcome(returnOf(`${fields}&iss=${issuer}`, profile), outcome)
    },
  )

  it.each(malformedReturns(profile, samples))(
    tagged('rejects %s before exchange [LIBID-OAUTH-007]', vectors),
    (_name, oauthReturn) => {
      expect(parseOAuthReturn(oauthReturn, production)).toBeNull()
      expect(thrown(() => accept(oauthReturn))).toMatchObject(invalid)
    },
  )

  it('decodes each value exactly once under the decoded bounds', () => {
    const fields = fieldsOf(samples.accepted.oauthReturn, profile)
    const { credential } = samples.accepted
    for (const [raw, decoded] of [
      [percentEncode(credential), credential],
      ['a+b%20c%2fd', 'a b c/d'],
      ['%252F', '%2F'],
      ['%2F'.repeat(4096), '/'.repeat(4096)],
    ]) {
      const changed = returnOf(setField(fields, profile.credential, raw), profile)
      expect(parseOAuthReturn(changed, production)).toEqual({
        ...expected.accepted,
        credential: decoded,
      })
      expect(accept(changed)).toBe(decoded)
    }
  })

  it('stops before reading the return once the run is closed', () => {
    const controller = new AbortController()
    controller.abort(new Error('Closed before return'))
    const context = proverContext(platformId, { signal: controller.signal })
    expect(() => acceptReturn(context, platformId)).toThrow('Closed before return')
  })

  it('resolves a bound denial and rejects a provider error before any network or proving work [LIBID-OAUTH-018]', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { prove } = await fixture.prover()
    await expect(
      prove(proverContext(platformId, { oauthReturn: samples.denied.oauthReturn })),
    ).resolves.toBeNull()
    await expect(
      prove(proverContext(platformId, { oauthReturn: samples.error.oauthReturn })),
    ).rejects.toMatchObject({ event: 'authorization' })
    expectNoProvingWork()
  })

  it('requires the catalog code-verifier choice and client before notarization [LIBID-OAUTH-021]', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { prove } = await fixture.prover()
    for (const request of [
      { codeVerifier: version.pkce ? null : 'A'.repeat(43) },
      { clientId: sharedTextRejections[1] },
    ])
      await expect(prove(proverContext(platformId, { request }))).rejects.toMatchObject({
        event: 'authorization',
      })
    expectNoProvingWork()
  })

  it('requires a valid public credential before exchange exactly when the catalog does', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { prove } = await fixture.prover()
    const missing = proverContext(platformId)
    delete missing.request.clientCredential
    if (platforms[platformId].requiresClientCredential) {
      await expect(prove(missing)).rejects.toMatchObject({ event: 'token-fetch' })
      await expect(
        prove(proverContext(platformId, { request: { clientCredential: 'has space' } })),
      ).rejects.toMatchObject({ event: 'token-fetch' })
      expectNoProvingWork()
    } else expect(acceptReturn(missing, platformId)).toBe(samples.accepted.credential)
  })
})

const kind = (value: unknown) =>
  value === null
    ? 'null'
    : value instanceof Uint8Array
      ? 'bytes'
      : Array.isArray(value)
        ? 'array'
        : typeof value

/** Missing, extra, non-record and wrong-typed variants of one valid exact record. */
function recordViolations(valid: object, wrong: Record<string, readonly unknown[]> = {}) {
  const record = valid as Record<string, unknown>
  const values = [undefined, null, true, 1, '1', new Uint8Array([1]), [], {}]
  return [
    null,
    [],
    'record',
    new Map(Object.entries(record)),
    Object.assign(Object.create({}), record),
    { ...record, extra: 1 },
    ...Object.keys(record).map((key) =>
      Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)),
    ),
    ...Object.entries(record).flatMap(([key, current]) =>
      [...values.filter((value) => kind(value) !== kind(current)), ...(wrong[key] ?? [])].map(
        (value) => ({ ...record, [key]: value }),
      ),
    ),
  ]
}

describe.each(supportedPlatforms)('%s result validators', (platformId) => {
  const fixture = fixtures[platformId]
  // The fixture is correlated with platformId; the union of its validators takes a widened view.
  const types = fixture.types as {
    validateIdentity(value: unknown): unknown
    validateProof(value: unknown, identity: unknown, authorizationDigest: Uint8Array): unknown
  }
  const validateIdentity = (value: unknown) => types.validateIdentity(value)
  const validateProof = (value: unknown) =>
    types.validateProof(value, fixture.identity, fixture.digest)
  const { acceptResult } = implementationFor(platformId, 1)

  it('accepts the fixture identity and proof and assembles them as separate result fields [LIBID-MOD-019]', () => {
    expect(validateIdentity(fixture.identity)).toBe(fixture.identity)
    expect(validateIdentity(fixture.longest)).toBe(fixture.longest)
    expect(validateProof(fixture.proof)).toBe(fixture.proof)
    expect(acceptResult(fixture.identity, fixture.proof, fixture.digest)).toEqual({
      identity: fixture.identity,
      proof: fixture.proof,
      expiresAt: fixture.expiresAt,
    })
    expect(fixture.proof).not.toHaveProperty('expiresAt')
    const { identity, proof, digest } = fixture
    const message = { type: 'identity-proof' as const, identity, proof }
    const nonce = new Uint8Array(32).fill(3)
    const result = assembleResult(platformId, 1, message, fixture.config.clientId, nonce, digest)
    expect(result).toEqual({
      status: 'accepted',
      identity: fixture.identity,
      oauthProof: {
        platformCeremonyVersion: 1,
        authorizationNonce: nonce,
        authorizationDigest: digest,
        expiresAt: fixture.expiresAt,
        proof: fixture.proof,
      },
    })
    if (result.status === 'accepted') {
      expect(result.oauthProof.authorizationNonce).not.toBe(nonce)
      expect(result.oauthProof.authorizationDigest).not.toBe(digest)
    }
    expect(() => assembleResult(platformId, 1, message, 'other-client', nonce, digest)).toThrow(
      'OAuth client ID mismatch',
    )
  })

  it(
    tagged(
      'checks profile identity encodings without reading evidence [LIBID-MOD-019]',
      fixture.specTests.identity,
    ),
    () => {
      const platformIds = [
        ...supportedPlatforms.filter((id) => id !== platformId),
        'other',
        '',
        platformId.toUpperCase(),
      ]
      for (const value of recordViolations(fixture.identity, { platformId: platformIds }))
        expect(() => validateIdentity(value), JSON.stringify(value)).toThrow(TypeError)
      for (const field of ['oauthClientId', 'userId', 'userName'] as const)
        for (const value of [
          ...sharedTextRejections,
          overLength(fixture.longest[field]),
          ...fixture.rejectedIdentity[field],
        ])
          expect(() => validateIdentity({ ...fixture.identity, [field]: value }), value).toThrow(
            TypeError,
          )
    },
  )

  it('rejects proofs with missing, extra, nested-identity, wrong-typed or out-of-bound fields [LIBID-MOD-019] [LIBID-OAUTH-013]', () => {
    for (const value of [
      ...recordViolations(fixture.proof, fixture.rejectedProof),
      { ...fixture.proof, identity: fixture.identity },
      // Expiry is derived on the application side, never delivered.
      { ...fixture.proof, expiresAt: fixture.expiresAt },
    ])
      expect(() => validateProof(value)).toThrow(TypeError)
  })
})

// Bearer-link expiry comes from the token attestation's creation time, never from the delivery.
// Compile-only result correlation and dynamic narrowing checks.
function checkResultTypes(result: IdentityResult) {
  const isGoogle = (
    value: IdentityResult,
  ): value is Extract<IdentityResult<'google'>, { status: 'accepted' }> =>
    value.status === 'accepted' &&
    value.identity.platformId === 'google' &&
    value.oauthProof.platformCeremonyVersion === 1
  if (isGoogle(result)) {
    const proof: Uint8Array = result.oauthProof.proof.identityProof
    const expiresAt: number = result.oauthProof.expiresAt
    const digest: Uint8Array = result.oauthProof.authorizationDigest
    const publicInputs: readonly string[] = result.oauthProof.proof.publicInputs
    // @ts-expect-error Delivered Google fields are readonly.
    result.oauthProof.proof.publicInputs.push('0x00')
    void digest
    void publicInputs
    void proof
    void expiresAt
  }
  if (result.status === 'accepted' && result.identity.platformId === 'google') {
    // @ts-expect-error A nested discriminator does not narrow its sibling.
    result.oauthProof.proof.identityProof
  }
  const googleProof = {} as OAuthProof<'google'>
  // @ts-expect-error Platform and proof must correspond.
  const invalid: IdentityResult = {
    status: 'accepted',
    identity: { platformId: 'x', oauthClientId: 'c', userId: '1', userName: 'a' },
    oauthProof: googleProof,
  }
  // @ts-expect-error Unsupported version.
  const unsupported: ProofByPlatformVersion['google'][2] = {}
  void invalid
  void unsupported
}

void checkResultTypes

const phases = (events: OperationEvent[], name: string) =>
  events.filter((event) => event.event === name).map((event) => event.phase)

/** The request head a notarized HTTP/1.1 session sends for `request`. */
const requestHead = (request: ExactHttpRequest) =>
  utf8(
    `${request.method} ${new URL(request.url).pathname} HTTP/1.1\r\n${Object.entries(
      request.headers,
    )
      .map(([k, v]) => `${k}: ${text(v)}\r\n`)
      .join('')}\r\n`,
  )

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
  codeVerifier: `B${'A'.repeat(42)}`,
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

// Pipelines: every platform meets one prove() contract, which its pipeline kind stages; each kind
// then adds the cases only it has.

/** Engine public inputs every pipeline must reject: reordered, resized, changed, or in noncanonical case. */
const engineInputChanges = {
  'public-input-order': 'out of order',
  'public-input-extra': 'with an extra field',
  'public-input-short': 'with a missing field',
  'public-input-changed': 'with a changed value',
  'public-input-case': 'in noncanonical case',
}

type EngineInputChange = keyof typeof engineInputChanges

/** Outcomes every pipeline kind stages: success, changed engine inputs, startup cancellation. */
type SharedOutcome = 'accepted' | EngineInputChange | 'startup-cancel'

/** `fields` as a staged engine returns them; each pipeline reorders them its own way. */
function changedEngineInputs(fields: string[], outcome: string) {
  if (outcome === 'public-input-extra') return [...fields, fields[0]]
  if (outcome === 'public-input-short') return fields.slice(0, -1)
  if (outcome === 'public-input-changed')
    return [
      ...fields.slice(0, -1),
      `0x${(BigInt(fields.at(-1)!) ^ 1n).toString(16).padStart(64, '0')}`,
    ]
  if (outcome === 'public-input-case')
    return fields.map((field) => `0x${field.slice(2).toUpperCase()}`)
  return fields
}

/** One staged run. `proof` and `untouched` are read after it settles. */
interface Staged {
  context: ProverContext
  events: OperationEvent[]
  /** Abort the run, as closing its document does. */
  abort(reason: Error): void
  /** The platform proof an accepted run delivers. */
  proof(): unknown
  /** The pipeline started no request and opened no notary session of its own. */
  untouched(): void
}

/** A run context that records observations and, for `startup-cancel`, aborts at the first. */
function runContext(
  platformId: PlatformId,
  outcome: string,
  change: Parameters<typeof proverContext>[1] = {},
) {
  const controller = new AbortController()
  const events: OperationEvent[] = []
  const context = proverContext(platformId, {
    signal: controller.signal,
    emit: (event) => {
      events.push(event)
      if (outcome === 'startup-cancel') controller.abort(new Error('Closed during startup'))
    },
    ...change,
  })
  return { context, events, abort: (reason: Error) => controller.abort(reason) }
}

const bearerFailures = {
  'identity-shape': 'Invalid identity response',
  'opening-range': 'Bearer opening is not unique',
  'shifted-range': 'Identity commitment must match notarization',
  'attestation-mismatch': 'attested authority changed',
}

type BearerOutcome = SharedOutcome | keyof typeof bearerFailures

/**
 * Mutate a selector consistently: both the hidden window and its returned range shift by one
 * byte without changing length. The test backend must detect that the resulting attestation
 * commits different bytes.
 */
function shiftIdentitySelection(transcript: BearerTranscript) {
  const select = transcript.selectIdentity
  vi.spyOn(transcript, 'selectIdentity').mockImplementation((value: Transcript, bearer: string) => {
    const selected = select(value, bearer)
    selected.bearerRange.start++
    selected.bearerRange.end++
    selected.ranges.sent[0].end++
    selected.ranges.sent[1].start++
    return selected
  })
}

/** A synthetic TLSN backend over real planning, correlation and attestation encoding. */
/**
 * A synthetic TLSN backend over real planning, correlation and attestation encoding. `held` sessions
 * wait on `gates` for the token response, token openings and final token attestation, and `log`
 * records each session call as it happens.
 */
function fakeNotarization(platformId: BearerLinkPlatform, outcome: BearerOutcome, held = false) {
  const { evidence } = fixtures[platformId]
  const gate = () => {
    const gate = Promise.withResolvers<void>()
    if (!held) gate.resolve()
    return gate
  }
  const gates = { tokenResponse: gate(), tokenOpenings: gate(), tokenAttestation: gate() }
  const log: string[] = []
  const session = (index: number) => (index === 0 ? 'token' : 'identity')
  const attestations: NotaryAttestation[] = []
  const transcripts: Transcript[] = []
  const selected: Reveals[] = []
  const commitments: { sent: Uint8Array[]; received: Uint8Array[] }[] = []
  let sessionCount = 0
  prepare.mockImplementation(async (url: string) => {
    const index = sessionCount++
    let transcript: Transcript
    return {
      async send(request: ExactHttpRequest) {
        log.push(`${session(index)} send`)
        if (index === 0) await gates.tokenResponse.promise
        expect(request.url).toBe(url)
        const body =
          index === 0
            ? evidence.tokenBody
            : outcome === 'identity-shape'
              ? evidence.misshapenIdentityBody
              : evidence.identityBody
        transcript = {
          sent: concat(requestHead(request), request.body),
          received: utf8(
            `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
          ),
        }
        transcripts[index] = transcript
        return transcript
      },
      async reveal(ranges: Reveals) {
        log.push(`${session(index)} reveal`)
        if (index === 0) await gates.tokenOpenings.promise
        selected[index] = ranges
        const plan = planNotarization(transcript, ranges)
        const raw = {
          sent: plan.commit.sent.map((range) => opening(transcript.sent, range, index + 1)),
          received: plan.commit.received.map((range) =>
            opening(transcript.received, range, index + 1),
          ),
        }
        commitments[index] = {
          sent: raw.sent.map((o) => o.hash),
          received: raw.received.map((o) => o.hash),
        }
        const host = new URL(url).hostname
        const attestedData = encodeAttestation(
          transcript,
          plan,
          commitments[index],
          plan.commit,
          host,
        )
        if (outcome === 'attestation-mismatch' && index === 0) attestedData[0] ^= 1
        const correlated = correlateReveal(transcript, plan, raw)
        verifyAttestation(host, transcript, plan, correlated, attestedData)
        const openings: CommitmentOpening[] = (['sent', 'received'] as const).flatMap((direction) =>
          correlated[direction].map(({ start, end, blinder }) => ({
            direction,
            start,
            end,
            blinder,
          })),
        )
        if (outcome === 'opening-range' && index === 1) openings[0].start++
        const attestation = { attestedData, signature: new Uint8Array(65).fill(index + 1) }
        attestations[index] = attestation
        return {
          openings: openings.reverse(),
          attestation:
            index === 0
              ? gates.tokenAttestation.promise.then(() => attestation)
              : Promise.resolve(attestation),
        }
      },
    }
  })
  return { attestations, transcripts, selected, commitments, gates, log }
}

/** The proof engine checks the witness against the fake backend's commitments. */
function fakeBearerProof(
  bearer: string,
  commitments: { sent: Uint8Array[]; received: Uint8Array[] }[],
  outcome: BearerOutcome,
) {
  const hashes = [1, 2].map((byte) => sha256(concat(utf8(bearer), new Uint8Array(16).fill(byte))))
  generate.mockImplementation(async (inputs): Promise<RawProof> => {
    expect(commitments[0].received, 'Token commitment must match notarization').toContainEqual(
      Uint8Array.from(inputs.token_commitment),
    )
    expect(commitments[1].sent, 'Identity commitment must match notarization').toEqual([
      Uint8Array.from(inputs.identity_commitment),
    ])
    expect(inputs).toEqual({
      bearer: [...utf8(bearer), ...new Uint8Array(128 - bearer.length)],
      bearer_len: String(bearer.length),
      blinder_token: Array(16).fill(1),
      blinder_identity: Array(16).fill(2),
      token_commitment: [...hashes[0]],
      identity_commitment: [...hashes[1]],
    })
    const ordered = outcome === 'public-input-order' ? [...hashes].reverse() : hashes
    return {
      proof: new Uint8Array([1]),
      publicInputs: changedEngineInputs(
        ordered.flatMap((hash) => [...hash].map((n) => `0x${n.toString(16).padStart(64, '0')}`)),
        outcome,
      ),
      runtime: { effectiveThreads: 2, sharedMemory: true },
    }
  })
}

/** Stage `outcome`; `held` sessions wait on their gates, and `change` edits the run context. */
function stageBearer(
  platformId: BearerLinkPlatform,
  outcome: BearerOutcome,
  {
    held = false,
    change = {},
  }: { held?: boolean; change?: Parameters<typeof proverContext>[1] } = {},
) {
  const fixture = fixtures[platformId]
  if (outcome === 'shifted-range') shiftIdentitySelection(fixture.transcript)
  const notarized = fakeNotarization(platformId, outcome, held)
  fakeBearerProof(fixture.evidence.bearer, notarized.commitments, outcome)
  return {
    ...runContext(platformId, outcome, change),
    notarized,
    proof: () => ({
      bearerLinkProof: new Uint8Array([1]),
      tokenAttestation: notarized.attestations[0],
      identityAttestation: notarized.attestations[1],
    }),
    untouched: () => expect(prepare).not.toHaveBeenCalled(),
  }
}

const oidcFailures = {
  'wrong-kid': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  'duplicate-key': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  'empty-key-set': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  expired: { event: 'authorization', message: expect.stringMatching(/token/i) },
  'audience-mismatch': { event: 'authorization', message: expect.stringMatching(/token/i) },
}

type OidcOutcome = SharedOutcome | keyof typeof oidcFailures

/** Token rejections that must happen before any key fetch or proof engine startup. */
const beforeProving: OidcOutcome[] = ['expired', 'audience-mismatch']

function oidcToken(idToken: string, outcome: OidcOutcome) {
  if (outcome === 'wrong-kid')
    return jwtWith(idToken, { header: { ...jwtPart(idToken, 0), kid: 'rotated-key' } })
  return idToken
}

/** An unrelated key published beside the fixture key. */
const previousKey = {
  kid: 'previous',
  kty: 'RSA',
  e: 'AQAB',
  n: b64urlEncode(new Uint8Array(256).fill(0xff)),
}

/** Publish `published` as the provider's key set. */
function publishKeys(published: object[]) {
  const keys = vi.fn(async (_url: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    return new Response(JSON.stringify({ keys: published }))
  })
  vi.stubGlobal('fetch', keys)
  return keys
}

/** Stage `outcome`; `change` replaces the signed token or the published fixture key. */
function stageOidc(
  platformId: OidcPlatform,
  outcome: OidcOutcome,
  change: { idToken?: string; jwk?: Record<string, string> } = {},
) {
  const fixture = fixtures[platformId]
  const { authorizationDigest, publicInputs } = fixture.evidence
  const { idToken = fixture.evidence.idToken, jwk = fixture.evidence.jwk } = change
  const { iat, exp } = jwtPart(fixture.evidence.idToken, 1) as { iat: number; exp: number }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((outcome === 'expired' ? exp : iat) * 1000)
  const keys = publishKeys(
    outcome === 'duplicate-key'
      ? [jwk, jwk]
      : outcome === 'empty-key-set'
        ? []
        : [previousKey, jwk],
  )
  const { config, oauthReturn: profile } = fixture
  const accepted = fieldsOf(returnSamples(platformId).accepted.oauthReturn, profile)
  const run = runContext(platformId, outcome, {
    oauthReturn: returnOf(
      setField(accepted, profile.credential, oidcToken(idToken, outcome)),
      profile,
    ),
    request: outcome === 'audience-mismatch' ? { clientId: `other-${config.clientId}` } : {},
  })
  generate.mockImplementation(async (inputs): Promise<RawProof> => {
    expect((inputs as Record<string, unknown>)[fixture.evidence.digestInput]).toEqual([
      ...authorizationDigest,
    ])
    const fields = [...publicInputs]
    if (outcome === 'public-input-order') fields.unshift(...fields.splice(1, 1))
    return {
      proof: new Uint8Array([1]),
      publicInputs: changedEngineInputs(fields, outcome),
      runtime: { effectiveThreads: 2, sharedMemory: true },
    }
  })
  return {
    ...run,
    keys,
    proof: () => fixture.proof,
    untouched: () => {
      expect(keys).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  }
}

/**
 * Each pipeline kind's stage for the shared outcomes, and the requirements its runs cover. A new
 * kind fails typecheck here until it can be staged. The fixture's pipeline selects the stage, so
 * the platform passed to it is of that kind.
 */
const pipelines = {
  'bearer-link': {
    stage: (platformId, outcome) => stageBearer(platformId as BearerLinkPlatform, outcome),
    tags: '[LIBID-PROVER-003] [LIBID-PROVER-004] [LIBID-PROVER-009] [LIBID-PROVER-021]',
    // Reported by the notary session this suite replaces; the session's own tests cover them.
    sessionReported: ['token-attestation', 'identity-attestation'],
  },
  oidc: {
    stage: (platformId, outcome) => stageOidc(platformId as OidcPlatform, outcome),
    tags: '[LIBID-PROVER-002] [LIBID-PROVER-021]',
    sessionReported: [],
  },
} satisfies Record<
  PlatformFixture<PlatformId>['pipeline'],
  {
    stage(platformId: PlatformId, outcome: SharedOutcome): Staged
    tags: string
    sessionReported: readonly string[]
  }
>

describe.each(supportedPlatforms)('%s prove() contract', (platformId) => {
  const fixture = fixtures[platformId]
  const { stage, tags } = pipelines[fixture.pipeline]
  const sessionReported: readonly string[] = pipelines[fixture.pipeline].sessionReported
  const title = (text: string) => tagged(text, `${tags} ${fixture.specTests.pipeline}`)
  async function run(outcome: SharedOutcome) {
    const staged = stage(platformId, outcome)
    return { staged, pending: (await fixture.prover()).prove(staged.context) }
  }

  it(
    title(
      'delivers the shared identity beside its proof through structured clone and client assembly',
    ),
    async () => {
      const { staged, pending } = await run('accepted')
      const result = await pending
      // Shared identity beside the platform proof; no nested identity or flattened inputs.
      expect(result).toEqual({ identity: fixture.identity, proof: staged.proof() })
      const delivery = structuredClone({ type: 'identity-proof' as const, ...result! })
      expect(
        assembleResult(
          platformId,
          1,
          delivery,
          fixture.config.clientId,
          new Uint8Array(32),
          fixture.digest,
        ),
      ).toMatchObject({ status: 'accepted', identity: fixture.identity })
      expectEngineAssets(platformId)
    },
  )

  it(title('reports each pipeline operation once, started before finished'), async () => {
    const { staged, pending } = await run('accepted')
    await pending
    const reported = fixture.operations.filter((name) => !sessionReported.includes(name))
    for (const operation of [...reported, 'circuit-inputs'])
      expect(phases(staged.events, operation), operation).toEqual(['started', 'finished'])
  })

  it(
    title('proves once under a signal that aborts with the run, and destroys its engine'),
    async () => {
      const staged = stage(platformId, 'accepted')
      const prove = generate.getMockImplementation()!
      const aborted: boolean[] = []
      generate.mockImplementation(async (inputs, signal) => {
        aborted.push(signal!.aborted)
        staged.abort(new Error('Closed while proving'))
        aborted.push(signal!.aborted)
        return prove(inputs, signal)
      })
      // Whether a result still settles is the document's concern; it discards late results.
      await Promise.allSettled([(await fixture.prover()).prove(staged.context)])
      expect(aborted).toEqual([false, true])
      expect(generate).toHaveBeenCalledOnce()
      expect(destroy).toHaveBeenCalledOnce()
    },
  )

  it.each(Object.entries(engineInputChanges) as [EngineInputChange, string][])(
    title('rejects engine public inputs %s and destroys its engine'),
    async (change) => {
      const { pending } = await run(change)
      await expect(pending).rejects.toThrow('public input mismatch')
      expect(destroy).toHaveBeenCalledOnce()
    },
  )

  it(title('stops at startup cancellation before network, notary or proving work'), async () => {
    const { staged, pending } = await run('startup-cancel')
    await expect(pending).rejects.toThrow('Closed during startup')
    staged.untouched()
    expect(generate).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })
})

describe.each(bearerLinkPlatforms)('%s bearer-link pipeline', (platformId) => {
  const fixture = fixtures[platformId]
  const { transcript, config, evidence, identity, longest, rejectedIdentity } = fixture
  const tags = `${pipelines['bearer-link'].tags} ${fixture.specTests.pipeline}`

  describe('transcripts', () => {
    const tokenTags = fixture.transcriptTests.token
    const identityTags = fixture.transcriptTests.identity
    const input: TokenRequestInput = {
      ...config,
      code: returnSamples(platformId).accepted.credential,
      redirectUri: 'https://bridge.test/auth/callback',
      codeVerifier: 'A'.repeat(43),
      // Form delimiters inside a public credential must stay inside its field.
      ...('clientCredential' in config
        ? { clientCredential: 'public&credential=with+delimiters%' }
        : {}),
    }
    const tokenUrl = new URL(fixture.tokenRequest.url)
    const identityUrl = new URL(fixture.identityRequest.url)
    /** A request as the TLSN prover writes it: lowercase names, reordered headers. */
    const tokenSent = (request: ExactHttpRequest = transcript.buildTokenRequest(input)) =>
      text(proverRequest(`POST ${tokenUrl.pathname} HTTP/1.1`, request))
    const token = (sent: string, body = evidence.tokenBody, frozen = input) =>
      transcript.selectToken({ sent: utf8(sent), received: httpResponse(body) }, frozen)
    const identitySent = text(
      proverRequest(
        `GET ${identityUrl.pathname} HTTP/1.1`,
        transcript.buildIdentityRequest(evidence.bearer),
      ),
    )
    const identityOf = (body: string, sent = identitySent) =>
      transcript.selectIdentity({ sent: utf8(sent), received: httpResponse(body) }, evidence.bearer)
    const members = (body: string) => revealed(httpResponse(body), identityOf(body).ranges.received)

    it('selects exactly the identity its validators admit from the identity response', () => {
      const sent = requestHead(transcript.buildIdentityRequest(evidence.bearer))
      const select = (body: string) =>
        transcript.selectIdentity(
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
      { code: 'x'.repeat(1025) },
      { redirectUri: 'https://bridge.test/callback?next=1' },
      { codeVerifier: 'a'.repeat(43) },
    ])('rejects invalid token inputs before request construction: %j', (change) => {
      expect(() => transcript.buildTokenRequest(input)).not.toThrow()
      expect(() => transcript.buildTokenRequest({ ...input, ...change })).toThrow(
        'Invalid token request',
      )
    })

    describe('token request', () => {
      it(
        tagged(
          'sends exactly its form to its endpoint and reveals it whole, committing only the bearer',
          tokenTags,
        ),
        () => {
          const request = transcript.buildTokenRequest(input)
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
          expect(selected.accessToken).toBe(evidence.bearer)
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
            expect(selected.accessToken).toBe(evidence.bearer)
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
      const length = transcript.buildTokenRequest(input).body.length
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

      it.each(formChanges(text(transcript.buildTokenRequest(input).body), input.code))(
        tagged(
          'rejects an altered form despite a matching Content-Length: %s [TEST-COMMON-05] [TEST-COMMON-06]',
          tokenTags,
        ),
        (body) => {
          const request = transcript.buildTokenRequest(input)
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
          expect(() => transcript.buildTokenRequest(changed)).not.toThrow()
          expect(() => token(tokenSent(), evidence.tokenBody, changed)).toThrow(
            'Token request body changed',
          )
        },
      )

      if (input.clientCredential !== undefined)
        it.each(['', 'has space', 'trailing\n', '\tcredential', 'é', '\x7f'])(
          'rejects an invalid public credential %j before request construction',
          (clientCredential) => {
            expect(() => transcript.buildTokenRequest({ ...input, clientCredential })).toThrow()
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
        ['an over-length bearer', bearing('a'.repeat(129))],
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
          const request = transcript.buildIdentityRequest(evidence.bearer)
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
          expect(() => transcript.buildIdentityRequest(bearer)).toThrow('Invalid bearer')
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
    const { acceptResult } = implementationFor(platformId, 1)
    const createdAt = (time: bigint) => {
      const attestedData = LIBID_RS_ATTESTED_DATA.slice()
      new DataView(attestedData.buffer).setBigUint64(32, time)
      return { attestedData, signature: new Uint8Array(65) }
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
      for (const [tokenTime, identityTime, expiresAt] of [
        [1_770_000_000, 1_770_000_100, 1_770_003_600],
        [1_770_000_000, 1_769_999_900, 1_770_003_600],
        [0, 0, 3600],
        [Number.MAX_SAFE_INTEGER - 3600, 0, Number.MAX_SAFE_INTEGER],
      ])
        expect(
          accept(createdAt(BigInt(tokenTime)), createdAt(BigInt(identityTime))).expiresAt,
        ).toBe(expiresAt)
    })

    it('rejects malformed token attestation bytes or unrepresentable expiry [LIBID-OAUTH-012]', () => {
      for (const tokenAttestation of [
        { attestedData: new Uint8Array([1]), signature: new Uint8Array(65) },
        createdAt(BigInt(Number.MAX_SAFE_INTEGER) - 3599n),
        createdAt(0xffffffffffffffffn),
      ])
        expect(() => accept(tokenAttestation)).toThrow(
          /invalid attested data|Proof expiry exceeds safe integer range/,
        )
    })
  })

  describe('composition', () => {
    it(
      tagged(
        'sends the code and the bearer in their requests and never discloses the bearer',
        tags,
      ),
      async () => {
        const staged = stageBearer(platformId, 'accepted')
        await (await fixture.prover()).prove(staged.context)
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
        'overlaps identity work with token openings and settles only on every output: %s [LIBID-PROVER-007] [LIBID-PROVER-013] [LIBID-PROVER-014] [TEST-PLAT-13]',
        tags,
      ),
      async (outcome) => {
        const staged = stageBearer(platformId, 'accepted', { held: true })
        const { gates, log } = staged.notarized
        // A failed final attestation must not wait for proof generation.
        if (outcome === 'failed') generate.mockReturnValue(new Promise(() => {}))
        let settled = false
        const pending = (await fixture.prover()).prove(staged.context).finally(() => {
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
          [fixture.tokenRequest.url, 'token-attestation'],
          [fixture.identityRequest.url, 'identity-attestation'],
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
        const staged = stageBearer(platformId, 'accepted')
        // Sessions stay in setup until the notary signal aborts; identity setup may fail first.
        const pending = () =>
          new Promise<never>((_, reject) => {
            const signal: AbortSignal = notarization.mock.calls[0][1]
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        const identitySetup = Promise.withResolvers<never>()
        prepare.mockImplementationOnce(pending).mockReturnValueOnce(identitySetup.promise)
        const result = (await fixture.prover()).prove(staged.context)
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
        const staged = stageBearer(platformId, 'accepted', {
          change: { request: { notaryAddress: null } },
        })
        await expect((await fixture.prover()).prove(staged.context)).rejects.toBeInstanceOf(Error)
        expect(notarization).not.toHaveBeenCalled()
        expect(prepare).not.toHaveBeenCalled()
        expect(generate).not.toHaveBeenCalled()
      },
    )

    it.each(Object.keys(bearerFailures) as (keyof typeof bearerFailures)[])(
      tagged('rejects %s and destroys its engine', tags),
      async (outcome) => {
        const staged = stageBearer(platformId, outcome)
        const pending = (await fixture.prover()).prove(staged.context)
        await expect(pending).rejects.toThrow(bearerFailures[outcome])
        // Circuit-input construction attributes its own failures.
        if (outcome === 'opening-range')
          await expect(pending).rejects.toMatchObject({ event: 'circuit-inputs' })
        expect(destroy).toHaveBeenCalledOnce()
      },
    )
  })
})

describe.each(oidcPlatforms)('%s OIDC pipeline', (platformId) => {
  const fixture = fixtures[platformId]
  const tags = `${pipelines.oidc.tags} [LIBID-OAUTH-007] [LIBID-OAUTH-021] ${fixture.specTests.pipeline}`

  it.each(Object.entries(fixture.rejectedBinding))(
    'rejects a well-formed proof with a mismatched %s [LIBID-OAUTH-014]',
    (_change, rebind) => {
      const { identity, proof } = rebind(fixture)
      expect(() => fixture.types.validateProof(proof, identity, fixture.digest)).toThrow(
        'public input mismatch',
      )
    },
  )

  it.each(Object.entries(fixture.rejectedEvidence))(
    tagged('rejects evidence with %s before generating a proof', tags),
    async (_name, change: EvidenceChange) => {
      const staged = stageOidc(platformId, 'accepted', {
        idToken: change.idToken?.(fixture.evidence.idToken),
        jwk: change.jwk?.(fixture.evidence.jwk),
      })
      await expect((await fixture.prover()).prove(staged.context)).rejects.toMatchObject({
        event: change.rejectedAt,
      })
      if (change.rejectedAt === 'authorization') expectNoProvingWork(staged.keys)
      expect(generate).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  )

  it(tagged('accepts its published signing key without optional members', tags), async () => {
    const staged = stageOidc(platformId, 'accepted', { jwk: fixture.evidence.minimalJwk })
    await expect((await fixture.prover()).prove(staged.context)).resolves.toEqual({
      identity: fixture.identity,
      proof: fixture.proof,
    })
  })

  it(
    tagged(
      'fetches its published signing key once, without credentials or redirects, and opens no notary connection',
      tags,
    ),
    async () => {
      const staged = stageOidc(platformId, 'accepted')
      await (await fixture.prover()).prove(staged.context)
      expect(staged.keys).toHaveBeenCalledOnce()
      expect(new URL(staged.keys.mock.calls[0][0]).protocol).toBe('https:')
      expect(staged.keys.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
      // The supplied notary address never opens a notary connection for this pipeline.
      expect(notarization).not.toHaveBeenCalled()
    },
  )

  it.each(Object.keys(oidcFailures) as (keyof typeof oidcFailures)[])(
    tagged('rejects %s before generating a proof', tags),
    async (outcome) => {
      const staged = stageOidc(platformId, outcome)
      await expect((await fixture.prover()).prove(staged.context)).rejects.toMatchObject(
        oidcFailures[outcome],
      )
      if (beforeProving.includes(outcome)) expectNoProvingWork(staged.keys)
      else expect(destroy).toHaveBeenCalledOnce()
      expect(generate).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  )
})
