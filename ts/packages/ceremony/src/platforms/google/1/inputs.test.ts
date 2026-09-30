import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GoogleCircuitInputs } from '../../../barretenberg/circuits/oidc_google/inputs.js'
import {
  googlePublicInputs as BB_PUBLIC_INPUTS,
  googleV1 as fixture,
  jwtWith,
} from '../../conformance/fixtures.js'
import { prepareGoogleInputs } from './inputs.js'
import { buildGooglePublicInputs } from './publicInputs.js'
import { parseGoogleIdToken } from './token.js'
import { validateProof } from './validation.js'

const digest = fixture.authorizationDigest

const ABI_KEYS: Array<keyof GoogleCircuitInputs> = [
  'signing_input',
  'signing_input_len',
  'header_b64_len',
  'payload_json',
  'payload_json_len',
  'email_offset',
  'nonce_offset',
  'sub_offset',
  'email_verified_offset',
  'exp_offset',
  'exp_len',
  'iss_offset',
  'aud_offset',
  'email_bytes',
  'email_len',
  'sub_bytes',
  'sub_len',
  'audience_bytes',
  'audience_len',
  'signature',
  'redc',
  'authorization_digest',
  'audience_hash',
  'sub_packed',
  'email_packed',
  'exp',
  'modulus',
]

function recompose(limbs: string[]): bigint {
  return limbs.reduce((value, limb, index) => value | (BigInt(limb) << (120n * BigInt(index))), 0n)
}

const _tokenWith = (change: Parameters<typeof jwtWith>[1]) => jwtWith(fixture.idToken, change)

const _tokenWithPayload = (payload: string) => jwtWith(fixture.idToken, { payload })

describe('[LIBID-PROVER-002] [TEST-PLAT-06] Google v1 circuit inputs and verifier fields', () => {
  it('builds the released ABI exactly from a valid fixed RS256 token and rejects each changed public input [TEST-COMMON-20]', () => {
    const [header, payload, signature] = fixture.idToken.split('.')
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: fixture.jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true)

    const { inputs, identity, proofFields } = prepareGoogleInputs(
      parseGoogleIdToken(fixture.idToken),
      fixture.jwk,
    )
    expect(Object.keys(inputs)).toEqual(ABI_KEYS)
    expect(inputs.signing_input_len).toBe('412')
    expect(inputs.header_b64_len).toBe('72')
    expect(inputs.payload_json_len).toBe('254')
    expect(inputs.signing_input.slice(0, 412)).toEqual(
      Array.from(Buffer.from(`${header}.${payload}`)),
    )
    expect(inputs.signing_input.slice(412).every((byte) => byte === 0)).toBe(true)
    expect(inputs.payload_json.slice(0, 254)).toEqual(Array.from(Buffer.from(payload, 'base64url')))
    expect(inputs.payload_json.slice(254).every((byte) => byte === 0)).toBe(true)
    expect({
      email: inputs.email_offset,
      nonce: inputs.nonce_offset,
      sub: inputs.sub_offset,
      emailVerified: inputs.email_verified_offset,
      exp: inputs.exp_offset,
      iss: inputs.iss_offset,
      aud: inputs.aud_offset,
    }).toEqual({
      email: '115',
      nonce: '166',
      sub: '85',
      emailVerified: '144',
      exp: '237',
      iss: '1',
      aud: '37',
    })
    expect(inputs.authorization_digest).toEqual(Array.from(digest))
    expect(recompose(inputs.signature)).toBe(
      BigInt(`0x${Buffer.from(signature, 'base64url').toString('hex')}`),
    )
    const modulus = BigInt(`0x${Buffer.from(fixture.jwk.n, 'base64url').toString('hex')}`)
    expect(recompose(inputs.modulus)).toBe(modulus)
    expect(recompose(inputs.redc)).toBe((1n << 4102n) / modulus)

    const proof = { identityProof: new Uint8Array([1]), ...proofFields }
    expect(buildGooglePublicInputs(digest, identity, proof)).toEqual(BB_PUBLIC_INPUTS)
    const delivery = { ...proof, publicInputs: BB_PUBLIC_INPUTS }
    expect(validateProof(delivery, identity, digest)).toBe(delivery)
    for (let index = 0; index < BB_PUBLIC_INPUTS.length; index++) {
      const publicInputs = [...BB_PUBLIC_INPUTS]
      publicInputs[index] = `0x${(BigInt(publicInputs[index]) ^ 1n).toString(16).padStart(64, '0')}`
      expect(() => validateProof({ ...delivery, publicInputs }, identity, digest)).toThrow(
        'Google public input mismatch',
      )
    }
  })
})
