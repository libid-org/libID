// Catalog contract: members, authorization request, configuration and prover registration.
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { Asset } from '../../assets/index.js'
import { proofAssets } from '../../barretenberg/barretenberg.assets.js'
import { proofEvents, proofWeights } from '../../barretenberg/events.js'
import { fetchCeremonyConfig } from '../../ccdp/client/config.js'
import { AUTHORIZATION_DIGEST_BYTES, MAX_CLIENT_CREDENTIAL_BYTES } from '../../ccdp/limits.js'
import { isCoreEvent } from '../../events.js'
import { notaryAssets } from '../../notary/notary.assets.js'
import { fixtures, notarizedPlatforms, oidcPlatforms, platformConfig } from '../../testing/index.js'
import {
  AUTHORIZATION_NONCE_BYTES,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../authorization.js'
import {
  ceremonyFor,
  commonVersions,
  isPlatformId,
  platforms,
  supportedPlatforms,
} from '../index.js'
import { assetsByPlatform, circuits } from '../platforms.assets.js'
import { provers } from '../provers.js'
import { overLength, recordViolations, sharedTextRejections, state } from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

it('covers exactly the catalog platforms', () => {
  expect(Object.keys(fixtures)).toEqual([...supportedPlatforms])
  expect(Object.keys(assetsByPlatform)).toEqual([...supportedPlatforms])
  expect([...notarizedPlatforms, ...oidcPlatforms].sort()).toEqual([...supportedPlatforms].sort())
})

describe.each(supportedPlatforms)('%s catalog contract', (platformId) => {
  const fixture = fixtures[platformId]
  const platform = platforms[platformId]
  const ceremony = ceremonyFor(platformId, 1)

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
    expect(() => ceremonyFor(platformId, 2 as 1)).toThrow('Unsupported platform version')
    expect(Object.keys(ceremony).sort()).toEqual([
      'acceptResult',
      'buildAuthorizationUrl',
      'events',
      'pkce',
      'progressWeights',
      'returnRules',
    ])
    // Code exchange binds the digest through PKCE; an implicit ID token carries it as the nonce.
    expect(ceremony.pkce).toBe(fixture.proverKind === 'notarized')
  })

  it('requests exactly its authorization endpoint and fields, in order, with the digest binding [TEST-PLAT-12]', () => {
    const digest = new Uint8Array(AUTHORIZATION_DIGEST_BYTES).fill(7)
    const codeVerifier = deriveCodeVerifier(
      digest,
      new Uint8Array(AUTHORIZATION_NONCE_BYTES).fill(9),
    )
    const input = {
      clientId: fixture.config.clientId,
      redirectUri: 'https://bridge.test/auth/callback',
      state,
      authorizationDigest: digest,
      codeChallenge: ceremony.pkce ? deriveCodeChallenge(codeVerifier) : null,
    }
    const url = new URL(ceremony.buildAuthorizationUrl(input))
    // Exactly the spec table's fields, in its order, and nothing else (REQ-COMMON-08).
    const { url: endpoint, fields } = fixture.authorizationRequest
    expect(`${url.origin}${url.pathname}`).toBe(endpoint)
    expect(url.search.slice(1)).toBe(new URLSearchParams(fields(input)).toString())
    expect(url.hash).toBe('')
    // The requested response is exactly what the platform's return rules accept.
    const params = url.searchParams
    expect(params.get('response_type') ?? 'code').toBe(fixture.returnRules.credentialField)
    expect(params.get('response_mode') ?? 'query').toBe(fixture.returnRules.transport)
    const malformed = {
      ...input,
      authorizationDigest: digest.slice(1),
      codeChallenge: ceremony.pkce ? codeVerifier.slice(1) : null,
    }
    expect(() => ceremony.buildAuthorizationUrl(malformed)).toThrow()
  })

  /** Whether JSON, which the Bridge serves configuration as, can carry `value` unchanged. */
  const onWire = (value: unknown) =>
    isDeepStrictEqual(JSON.parse(JSON.stringify(value) ?? 'null'), value) &&
    !(
      value instanceof Object &&
      ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value))
    )

  /** The platform's entry as the Bridge serves it in configuration. */
  async function validate(entry: unknown) {
    const record = { ccdpOrigin: 'https://ccdp.test', platforms: { [platformId]: entry } }
    vi.stubGlobal('fetch', async () => Response.json(record))
    return (await fetchCeremonyConfig('https://bridge.test')).platforms[platformId]
  }

  it('admits its fixture, boundary and admitted client IDs and rejects empty, quoted, control, non-ASCII, over-length and platform-reserved ones, as a predicate and in configuration [TEST-COMMON-09]', async () => {
    const { config, identity, longest, rejectedIdentity, admittedClientIds } = fixture
    expect(identity.oauthClientId).toBe(config.clientId)
    for (const clientId of [config.clientId, longest.oauthClientId, ...admittedClientIds]) {
      expect(platform.isClientId(clientId), clientId).toBe(true)
      await expect(validate({ ...platformConfig(platformId), clientId })).resolves.toMatchObject({
        clientId,
      })
    }
    for (const clientId of [
      ...sharedTextRejections,
      overLength(longest.oauthClientId),
      ...rejectedIdentity.oauthClientId,
    ]) {
      expect(platform.isClientId(clientId), clientId).toBe(false)
      await expect(
        validate({ ...platformConfig(platformId), clientId }),
        clientId,
      ).rejects.toThrow()
    }
    for (const clientId of [42, null]) expect(platform.isClientId(clientId)).toBe(false)
  })

  it('requires a valid public token-exchange credential in configuration exactly when the catalog does [TEST-BRIDGE-03]', async () => {
    const { clientCredential, ...withoutCredential } = platformConfig(platformId)
    await expect(validate(platformConfig(platformId))).resolves.toEqual(platformConfig(platformId))
    if (platform.requiresClientCredential) {
      expect(clientCredential).toBeDefined()
      await expect(validate(withoutCredential)).rejects.toThrow()
    } else
      await expect(
        validate({ ...withoutCredential, clientCredential: 'public-fixture' }),
      ).rejects.toThrow()
    for (const clientCredential of [
      null,
      1,
      '',
      'has space',
      'tail\n',
      'é',
      'a\nb',
      'x'.repeat(MAX_CLIENT_CREDENTIAL_BYTES + 1),
    ])
      await expect(validate({ ...withoutCredential, clientCredential })).rejects.toThrow()
  })

  it('accepts exactly its one-client configuration record, refusing retired and unknown fields [LIBID-MOD-011] [LIBID-OAUTH-001]', async () => {
    const entry = platformConfig(platformId)
    for (const value of [
      ...recordViolations(entry).filter(onWire),
      // Retired per-version shapes: one OAuth client serves every version.
      { ...entry, ceremonyVersions: [1] },
      { ...entry, versions: [{ version: 1, clientId: entry.clientId }] },
      { ...entry, versionOverrides: { '1': { clientId: 'other' } } },
      { ...entry, tokenExchangeCredential: 'retired' },
    ])
      await expect(validate(value), JSON.stringify(value)).rejects.toThrow(TypeError)
  })

  it('registers its own prover for its catalog version', async () => {
    // The fixture imports its prover independently of the Prover's table.
    expect(await provers[platformId][1]()).toBe(await fixture.prover())
  })

  it('weights every prover operation once and ships its proof and prover resources', () => {
    const { events, progressWeights } = ceremony
    expect(Object.keys(progressWeights).sort()).toEqual(
      [...Object.keys(proofWeights), ...fixture.operations].sort(),
    )
    for (const weight of Object.values(progressWeights))
      expect(Number.isInteger(weight) && weight > 0).toBe(true)
    expect(events).toEqual(expect.arrayContaining([...proofEvents]))
    for (const event of events) expect(isCoreEvent(event)).toBe(true)
    const assets: readonly Asset[] = assetsByPlatform[platformId][1]
    const proverAssets = fixture.proverKind === 'notarized' ? notaryAssets : []
    expect(assets).toEqual(expect.arrayContaining([...proofAssets, ...proverAssets]))
    expect(circuits.filter((circuit) => assets.includes(circuit))).toHaveLength(1)
  })
})
