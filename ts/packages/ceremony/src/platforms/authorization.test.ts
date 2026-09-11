import { describe, expect, it } from 'vitest'
import { b64urlEncode } from '../primitives.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
  operationDomainFromString,
} from './authorization.js'

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// The ceremony-common §5 conformance vector (TEST-COMMON-01).
const operationDomain = operationDomainFromString('libid.claim-identity')

const chainId = operationDomainFromString('example:1')

const authorizationNonce = new Uint8Array(32).fill(0x55)

const transactionData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

describe('[TEST-COMMON-01] authorization digest', () => {
  it('reproduces the §5 conformance vector exactly', () => {
    expect(hex(operationDomain)).toBe(
      'cb29bed0428519ef88a3d670e8203db76e06f41aca3e684e2c63b516c9b93e1b',
    )
    expect(hex(chainId)).toBe('38064d82f31db40935cc75f2a0d07dcfb448d7c08e7484fc30f5de95484a4066')
    const digest = deriveAuthorizationDigest({
      operationDomain,
      platformCeremonyVersion: 1,
      chainId,
      authorizationNonce,
      transactionData,
    })
    expect(hex(digest)).toBe('b318fb559e16a179b853ed2853576cda16032d93b0839bb81a55135d334c0af5')
  })

  it('[TEST-COMMON-04] distinct nonces over identical transaction data yield distinct digests', () => {
    const base = { operationDomain, platformCeremonyVersion: 1, chainId, transactionData }
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
      chainId,
      authorizationNonce,
      transactionData,
    }
    expect(() =>
      deriveAuthorizationDigest({ ...base, operationDomain: operationDomain.slice(1) }),
    ).toThrow(/32 bytes/)
    expect(() => deriveAuthorizationDigest({ ...base, chainId: new Uint8Array(33) })).toThrow(
      /32 bytes/,
    )
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
      chainId,
      authorizationNonce,
      transactionData,
    }
    expect(hex(deriveAuthorizationDigest(args))).toBe(hex(deriveAuthorizationDigest(args)))
  })
})

describe('[TEST-COMMON-07] PKCE derivation', () => {
  const digest = deriveAuthorizationDigest({
    operationDomain,
    platformCeremonyVersion: 1,
    chainId,
    authorizationNonce,
    transactionData,
  })

  it('reproduces the §7 conformance vector exactly', () => {
    const verifier = deriveCodeVerifier(digest, authorizationNonce)
    expect(verifier).toBe('5teBDl6cz4U77aFweV5PbMhBJ_lEFv6LLNKzqnDI5lo')
    expect(deriveCodeChallenge(verifier)).toBe('c8HLMaJOzc8OUoRYc7AocL5ioAkXVtAOmoGxoSY60IQ')
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

  it('matches the §3.1 Google nonce encoding of the same digest', () => {
    // Google carries the digest itself, base64url-encoded, as the OIDC nonce.
    expect(b64urlEncode(digest)).toBe('sxj7VZ4WoXm4U-0oU1ds2hYDLZOwg5u4GlUTXTNMCvU')
  })
})
