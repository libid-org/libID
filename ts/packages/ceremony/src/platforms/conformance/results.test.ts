import { describe, expect, it, vi } from 'vitest'
import { fixtures } from '../../testing/index.js'
import { AUTHORIZATION_NONCE_BYTES } from '../authorization.js'
import type { IdentityResult, OAuthProof, ProofByPlatformVersion } from '../index.js'
import { assembleResult, ceremonyFor, supportedPlatforms } from '../index.js'
import { overLength, recordViolations, sharedTextRejections, tagged } from './stages.js'

vi.mock('../../assets/index.js', async (original) =>
  (await import('./mocks.js')).assetsModule(await original()),
)
vi.mock('../../barretenberg/engine.js', async () => (await import('./mocks.js')).engineModule)
vi.mock('../../notary/session.js', async () => (await import('./mocks.js')).sessionModule)

describe.each(supportedPlatforms)('%s result validators', (platformId) => {
  const fixture = fixtures[platformId]
  // The fixture is correlated with platformId; the union of its validators takes a widened view.
  const validation = fixture.validation as {
    validateIdentity(value: unknown): unknown
    validateProof(value: unknown, identity: unknown, authorizationDigest: Uint8Array): unknown
  }
  const validateIdentity = (value: unknown) => validation.validateIdentity(value)
  const validateProof = (value: unknown) =>
    validation.validateProof(value, fixture.identity, fixture.digest)
  const { acceptResult } = ceremonyFor(platformId, 1)

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
    const nonce = new Uint8Array(AUTHORIZATION_NONCE_BYTES).fill(3)
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
