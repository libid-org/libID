import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { validateIdentity as github } from './github/1/types.js'
import { buildGooglePublicInputs } from './google/1/publicInputs.js'
import { validateIdentity as google, isClientId, validateProof } from './google/1/types.js'
import type { IdentityResult, OAuthProof, ProofByPlatformVersion } from './index.js'
import { assembleResult } from './index.js'
import { validateIdentity as x } from './x/1/types.js'

it('checks profile identity encodings without reading evidence [LIBID-MOD-019] [TEST-PLAT-02]', () => {
  for (const [validate, identity, badNames] of [
    [
      google,
      { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
      ['é', 'a"b'],
    ],
    [x, { platformId: 'x', oauthClientId: 'client', userId: '1', userName: 'a_b' }, ['a-b', 'é']],
    [
      github,
      { platformId: 'github', oauthClientId: 'client', userId: '1', userName: 'a-b' },
      ['a_b', 'a--b', '-a'],
    ],
  ] as const) {
    expect(validate(identity)).toBe(identity)
    for (const userName of badNames) expect(() => validate({ ...identity, userName })).toThrow()
    expect(() => validate({ ...identity, platformId: 'other' })).toThrow()
    if (identity.platformId !== 'google') {
      for (const userId of ['0', '01', '18446744073709551616'])
        expect(() => validate({ ...identity, userId })).toThrow()
      expect(() => validate({ ...identity, oauthClientId: 'a+b' })).toThrow()
    }
  }
})

it('admits only Google client IDs a signed circuit audience can equal', () => {
  expect(isClientId('123-abc.apps.googleusercontent.com')).toBe(true)
  for (const clientId of ['', 'a"b', 'é', 'a\nb', 'x'.repeat(129), 42])
    expect(isClientId(clientId)).toBe(false)
})

it('narrows the separate identity/proof message and rejects nested identity [LIBID-MOD-019]', () => {
  const digest = new Uint8Array(32).fill(7)
  const fields = { tokenExpiresAt: 42, signingKeyModulus: new Uint8Array(256) }
  const identity = {
    platformId: 'google' as const,
    oauthClientId: 'client',
    userId: '1',
    userName: 'a@b.c',
  }
  const message = {
    type: 'identity-proof' as const,
    identity,
    proof: {
      identityProof: new Uint8Array([1]),
      ...fields,
      publicInputs: buildGooglePublicInputs(digest, identity, fields),
    },
  }
  expect(assembleResult('google', 1, message, 'client', new Uint8Array(32), digest)).toMatchObject({
    identity: message.identity,
    oauthProof: { proof: message.proof, expiresAt: 42, authorizationDigest: digest },
  })
  expect(() =>
    validateProof({ ...message.proof, identity: message.identity }, identity, digest),
  ).toThrow()
  expect(() => validateProof({ ...message.proof, expiresAt: 42 }, identity, digest)).toThrow()
})

it('requires a dense array of 56 canonical Google fields [LIBID-OAUTH-013]', () => {
  const digest = new Uint8Array(32)
  const identity = {
    platformId: 'google' as const,
    oauthClientId: 'client',
    userId: '1',
    userName: 'a@b.c',
  }
  const fields = { tokenExpiresAt: 42, signingKeyModulus: new Uint8Array(256) }
  const valid = buildGooglePublicInputs(digest, identity, fields)
  for (const publicInputs of [
    undefined,
    null,
    {},
    [],
    valid.slice(1),
    [...valid, valid[0]],
    new Array(56),
    ...[
      0,
      null,
      '0x00',
      '00'.repeat(32),
      `0X${'00'.repeat(32)}`,
      `0x${'AA'.repeat(32)}`,
      `0x${'gg'.repeat(32)}`,
      `${valid[0]}\n`,
    ].map((field) => [field, ...valid.slice(1)]),
  ]) {
    expect(() =>
      validateProof(
        { identityProof: new Uint8Array([1]), ...fields, publicInputs },
        identity,
        digest,
      ),
    ).toThrow('Invalid Google proof')
  }
})

// Canonical libid-rs fixture: the u64 creation timestamp starts after the 32-byte authority.
const attestedData = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL('../notary/libid-rs-239a4bb-attested-data.fixture.hex', import.meta.url),
      'utf8',
    ).trim(),
    'hex',
  ),
)
function attestation(createdAt: bigint) {
  const bytes = attestedData.slice()
  new DataView(bytes.buffer).setBigUint64(32, createdAt)
  return { attestedData: bytes, signature: new Uint8Array(65) }
}

it.each(['x', 'github'] as const)(
  '%s expiry uses only token attestation time and the launch lifetime [LIBID-OAUTH-012]',
  (platformId) => {
    for (const [tokenTime, identityTime, expiresAt] of [
      [1_770_000_000, 1_770_000_100, 1_770_003_600],
      [1_770_000_000, 1_769_999_900, 1_770_003_600],
      [0, 0, 3600],
      [Number.MAX_SAFE_INTEGER - 3600, 0, Number.MAX_SAFE_INTEGER],
    ]) {
      const proof = {
        bearerLinkProof: new Uint8Array([1]),
        tokenAttestation: attestation(BigInt(tokenTime)),
        identityAttestation: attestation(BigInt(identityTime)),
      }
      const message = {
        type: 'identity-proof' as const,
        identity: { platformId, oauthClientId: 'client', userId: '1', userName: 'alice' },
        proof,
      }
      const result = assembleResult(
        platformId,
        1,
        message,
        'client',
        new Uint8Array(32),
        new Uint8Array(32),
      )
      expect(result).toMatchObject({ status: 'accepted', oauthProof: { proof, expiresAt } })
      expect(proof).not.toHaveProperty('expiresAt')
      expect(() =>
        assembleResult(
          platformId,
          1,
          { ...message, proof: { ...proof, expiresAt } },
          'client',
          new Uint8Array(32),
          new Uint8Array(32),
        ),
      ).toThrow(`Invalid ${platformId} proof`)
    }
  },
)

it.each(['x', 'github'] as const)(
  '%s rejects malformed token attestation bytes or unrepresentable expiry [LIBID-OAUTH-012]',
  (platformId) => {
    for (const tokenAttestation of [
      { attestedData: new Uint8Array([1]), signature: new Uint8Array(65) },
      attestation(BigInt(Number.MAX_SAFE_INTEGER) - 3599n),
      attestation(0xffffffffffffffffn),
    ]) {
      expect(() =>
        assembleResult(
          platformId,
          1,
          {
            type: 'identity-proof',
            identity: { platformId, oauthClientId: 'client', userId: '1', userName: 'alice' },
            proof: {
              bearerLinkProof: new Uint8Array([1]),
              tokenAttestation,
              identityAttestation: attestation(1_770_000_000n),
            },
          },
          'client',
          new Uint8Array(32),
          new Uint8Array(32),
        ),
      ).toThrow(/invalid attested data|Proof expiry exceeds safe integer range/)
    }
  },
)

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
