import { expect, it } from 'vitest'
import { validateIdentity as github } from './github/1/types.js'
import { validateIdentity as google, validateProof } from './google/1/types.js'
import type { IdentityResult, OAuthProof, ProofByPlatformVersion } from './index.js'
import { validateProofMessage } from './index.js'
import { validateIdentity as x } from './x/1/types.js'

it('checks profile identity encodings without reading evidence [LIBID-MOD-019]', () => {
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

it('narrows the separate identity/proof message and rejects nested identity [LIBID-MOD-019]', () => {
  const message = {
    type: 'identity-proof' as const,
    identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
    proof: {
      identityProof: new Uint8Array([1]),
      tokenExpiresAt: 42,
      signingKeyModulus: new Uint8Array(256),
    },
  }
  expect(validateProofMessage('google', 1, message)).toBe(message)
  expect(() => validateProof({ ...message.proof, identity: message.identity })).toThrow()
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
    void proof
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
