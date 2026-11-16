import { keccak_256 } from '@noble/hashes/sha3.js'
import { describe, expect, it } from 'vitest'
import { b64urlEncode } from '../primitives.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from './authorization.js'

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// The ceremony-common §5 conformance vector (TEST-COMMON-01).
const operationDomain = keccak_256(new TextEncoder().encode('libid.claim-identity'))

const authorizationNonce = new Uint8Array(32).fill(0x55)

const transactionData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

describe('[TEST-COMMON-01] authorization digest', () => {
  it('reproduces the §5 conformance vector exactly', () => {
    expect(hex(operationDomain)).toBe(
      'cb29bed0428519ef88a3d670e8203db76e06f41aca3e684e2c63b516c9b93e1b',
    )
    const digest = deriveAuthorizationDigest({
      operationDomain,
      platformCeremonyVersion: 1,
      authorizationNonce,
      transactionData,
    })
    expect(hex(digest)).toBe('24083f6c849372d1fa0a95615a7b2b6a888edef92e9fa2bebd520b2f536e9350')
  })

  it('[TEST-COMMON-04] distinct nonces over identical transaction data yield distinct digests', () => {
    const base = { operationDomain, platformCeremonyVersion: 1, transactionData }
    const a = deriveAuthorizationDigest({ ...base, authorizationNonce })
    const b = deriveAuthorizationDigest({
      ...base,
      authorizationNonce: new Uint8Array(32).fill(0x56),
    })
    expect(hex(a)).not.toBe(hex(b))
  })

  it('rejects values that do not fit their fixed-width field', () => {
    const base = {
      operationDomain,
      platformCeremonyVersion: 1,
      authorizationNonce,
      transactionData,
    }
    expect(() =>
      deriveAuthorizationDigest({ ...base, operationDomain: operationDomain.slice(1) }),
    ).toThrow(/32 bytes/)
    expect(() =>
      deriveAuthorizationDigest({ ...base, authorizationNonce: new Uint8Array(31) }),
    ).toThrow(/32 bytes/)
    for (const version of [-1, 1.5, 0x10000, Number.NaN]) {
      expect(() =>
        deriveAuthorizationDigest({ ...base, platformCeremonyVersion: version }),
      ).toThrow(/16-bit/)
    }
  })

  it('is a pure function of its inputs', () => {
    const args = {
      operationDomain,
      platformCeremonyVersion: 1,
      authorizationNonce,
      transactionData,
    }
    expect(hex(deriveAuthorizationDigest(args))).toBe(hex(deriveAuthorizationDigest(args)))
  })
})

// The Operation List vector of chain profiles §3.3, as its six literal words.
describe('[TEST-COMMON-02B] operation list digest', () => {
  const words = [
    '0000000000000000000000000000000000000000000000000000000000000020',
    '0000000000000000000000000000000000000000000000000000000000000002',
    '4d59cd4487de0a5957f8c83addaac7a1238175aa5c29eeea2fbef57a8f5165ac',
    'aafae41182fdefb0af836c3b506e127c7f229f33360c66de1139f4b0316f09d8',
    '6b8fd3a153cb2bc403041d7ca7d029d031243d8143d49a248230df9dd07fb723',
    '8b1a944cf13a9a1c08facb2c9e98623ef3254d2ddb48113885c3e8e97fec8db9',
  ]
  const listData = Uint8Array.from(words.join('').match(/../g) ?? [], (b) => Number.parseInt(b, 16))
  const keccakUtf8 = (s: string) => hex(keccak_256(new TextEncoder().encode(s)))

  it('commits the domains and data hashes the spec names', () => {
    expect(words[2]).toBe(keccakUtf8('libid.bind-identity'))
    expect(words[4]).toBe(keccakUtf8('libid.test.a'))
    const target = new Uint8Array(32)
    target.fill(0x11, 12)
    expect(words[3]).toBe(hex(keccak_256(target)))
    expect(words[5]).toBe(hex(keccak_256(new Uint8Array([0xff]))))
  })

  it('reproduces the vector digest exactly', () => {
    expect(listData.length).toBe(192)
    const digest = deriveAuthorizationDigest({
      operationDomain: keccak_256(new TextEncoder().encode('libid.operations')),
      platformCeremonyVersion: 1,
      authorizationNonce,
      transactionData: listData,
    })
    expect(hex(digest)).toBe('8eb2153142c324145458f77cd7709e6375ae24b22fa59351549afc522d82c1fb')
  })
})

describe('[TEST-COMMON-07] PKCE derivation', () => {
  const digest = deriveAuthorizationDigest({
    operationDomain,
    platformCeremonyVersion: 1,
    authorizationNonce,
    transactionData,
  })

  it('reproduces the §7 conformance vector exactly [LIBID-OAUTH-016]', () => {
    const verifier = deriveCodeVerifier(digest, authorizationNonce)
    expect(verifier).toBe('rx2URZOjavkbyhw8BXSYLcJRjifbdVFcolqJK7HBVGQ')
    expect(deriveCodeChallenge(verifier)).toBe('L6b8OlTpVUwPgkYcOYwl-iZdsMj1AN4bN_-DTAPNsX0')
  })

  it('always yields exactly 43 unpadded base64url characters', () => {
    for (const fill of [0, 1, 0x7f, 0xff]) {
      const verifier = deriveCodeVerifier(digest, new Uint8Array(32).fill(fill))
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(deriveCodeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('rejects inputs of the wrong width', () => {
    expect(() => deriveCodeVerifier(digest.slice(1), authorizationNonce)).toThrow(/32 bytes/)
    expect(() => deriveCodeVerifier(digest, new Uint8Array(16))).toThrow(/32 bytes/)
  })

  it('matches the §3.1 Google nonce encoding of the same digest [TEST-PLAT-01]', () => {
    // Google carries the digest itself, base64url-encoded, as the OIDC nonce.
    expect(b64urlEncode(digest)).toBe('JAg_bISTctH6CpVhWnsraoiO3vkun6K-vVILL1Nuk1A')
  })
})

// The native serializer used by the authorization and token request builders.
it('reproduces the §6 canonical form vector [TEST-COMMON-05]', () => {
  expect(
    new URLSearchParams([
      ['label', 'A B'],
      ['redirect_uri', 'https://redirect.example/oauth/redirect'],
      ['state', '_-~'],
    ]).toString(),
  ).toBe('label=A+B&redirect_uri=https%3A%2F%2Fredirect.example%2Foauth%2Fredirect&state=_-%7E')
})
