import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGoogleWitness, type GoogleCircuitInputs } from './inputs.js'
import { buildGooglePublicInputs, validateGooglePublicInputs } from './publicInputs.js'

interface Fixture {
  idToken: string
  jwk: Record<string, string>
  authorizationDigest: string
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../../test-fixtures/google-v1.json', import.meta.url), 'utf8'),
) as Fixture
const digest = new Uint8Array(Buffer.from(fixture.authorizationDigest, 'hex'))

// Generated once by running this fixture through the official libid-circuits
// v0.3.0 oidc_google ACIR and bb.js 5.2.0, not by this adapter.
const BB_PUBLIC_INPUTS = [
  '0x00000000000000000000000000000000000000000000000000000000000000b3',
  '0x0000000000000000000000000000000000000000000000000000000000000018',
  '0x00000000000000000000000000000000000000000000000000000000000000fb',
  '0x0000000000000000000000000000000000000000000000000000000000000055',
  '0x000000000000000000000000000000000000000000000000000000000000009e',
  '0x0000000000000000000000000000000000000000000000000000000000000016',
  '0x00000000000000000000000000000000000000000000000000000000000000a1',
  '0x0000000000000000000000000000000000000000000000000000000000000079',
  '0x00000000000000000000000000000000000000000000000000000000000000b8',
  '0x0000000000000000000000000000000000000000000000000000000000000053',
  '0x00000000000000000000000000000000000000000000000000000000000000ed',
  '0x0000000000000000000000000000000000000000000000000000000000000028',
  '0x0000000000000000000000000000000000000000000000000000000000000053',
  '0x0000000000000000000000000000000000000000000000000000000000000057',
  '0x000000000000000000000000000000000000000000000000000000000000006c',
  '0x00000000000000000000000000000000000000000000000000000000000000da',
  '0x0000000000000000000000000000000000000000000000000000000000000016',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
  '0x000000000000000000000000000000000000000000000000000000000000002d',
  '0x0000000000000000000000000000000000000000000000000000000000000093',
  '0x00000000000000000000000000000000000000000000000000000000000000b0',
  '0x0000000000000000000000000000000000000000000000000000000000000083',
  '0x000000000000000000000000000000000000000000000000000000000000009b',
  '0x00000000000000000000000000000000000000000000000000000000000000b8',
  '0x000000000000000000000000000000000000000000000000000000000000001a',
  '0x0000000000000000000000000000000000000000000000000000000000000055',
  '0x0000000000000000000000000000000000000000000000000000000000000013',
  '0x000000000000000000000000000000000000000000000000000000000000005d',
  '0x0000000000000000000000000000000000000000000000000000000000000033',
  '0x000000000000000000000000000000000000000000000000000000000000004c',
  '0x000000000000000000000000000000000000000000000000000000000000000a',
  '0x00000000000000000000000000000000000000000000000000000000000000f5',
  '0x000000000000000000000000000000002f36be056956af2b8464eba0d8b9c613',
  '0x00000000000000000000000000000000f8c22af17a2f81cb1421e176333e62ab',
  '0x0031323334353637383930313233343536373839303100000000000000000000',
  '0x00686f6c646572406578616d706c652e636f6d00000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000000000000000000066d17750',
  '0x0000000000000000000000000000000000cd715c0efe8683fd563164874536bd',
  '0x000000000000000000000000000000000011eec56f0c610cb4d2bd31204e1121',
  '0x0000000000000000000000000000000000201ea9c85ddce480b8cda1f4673562',
  '0x0000000000000000000000000000000000111a83b8970370c51e741eb1918d02',
  '0x00000000000000000000000000000000006039a9bf04504bc1ca76739edf7bbf',
  '0x0000000000000000000000000000000000cf514484f627426ffadcf3d905b278',
  '0x0000000000000000000000000000000000a31f43a9d304373400a07dce94cc15',
  '0x00000000000000000000000000000000008cd7035c6ba90f3e1b446a884180f5',
  '0x00000000000000000000000000000000006db825137247cbc476b1aa2f5f0b44',
  '0x000000000000000000000000000000000088ed355105917f5c379a2f310bfa98',
  '0x0000000000000000000000000000000000b291209dc9b8c0dfaf757bb47a8d22',
  '0x0000000000000000000000000000000000f0271b22324fd79aa41b131e5131ac',
  '0x0000000000000000000000000000000000da9b7daa31b64a24c636d4bc0ff924',
  '0x0000000000000000000000000000000000ef54670783d3c2fceb452f8ad2064a',
  '0x000000000000000000000000000000000012212c1aa0b21f72bb5382e71df69d',
  '0x000000000000000000000000000000000021ea009feb157a6ab19975d1035fdf',
  '0x000000000000000000000000000000000042e8ca9546c840fd469c1789ca029b',
  '0x00000000000000000000000000000000000000000000000000000000000000bd',
]

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

function tokenWith(change: {
  header?: Record<string, unknown>
  payload?: Record<string, unknown>
  signature?: Uint8Array
}): string {
  const [header, payload, signature] = fixture.idToken.split('.')
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    change.header ? encode(change.header) : header,
    change.payload ? encode(change.payload) : payload,
    change.signature ? Buffer.from(change.signature).toString('base64url') : signature,
  ].join('.')
}

function tokenWithPayload(payload: string): string {
  const [header, , signature] = fixture.idToken.split('.')
  return `${header}.${Buffer.from(payload).toString('base64url')}.${signature}`
}

describe('[LIBID-PROVER-002] Google v1 witness and verifier fields', () => {
  it('builds the released ABI exactly from a valid fixed RS256 token', () => {
    const [header, payload, signature] = fixture.idToken.split('.')
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: fixture.jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true)

    const { inputs, proofFields } = buildGoogleWitness(fixture.idToken, fixture.jwk)
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
    expect(buildGooglePublicInputs(digest, proof)).toEqual(BB_PUBLIC_INPUTS)
  })

  it('rejects malformed token and JWK values before witness construction', () => {
    const payload = JSON.parse(
      Buffer.from(fixture.idToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>
    const header = JSON.parse(
      Buffer.from(fixture.idToken.split('.')[0], 'base64url').toString(),
    ) as Record<string, unknown>
    const payloadJson = Buffer.from(fixture.idToken.split('.')[1], 'base64url').toString()
    const cases: Array<[string, string, unknown]> = [
      ['wrong algorithm', tokenWith({ header: { ...header, alg: 'ES256' } }), fixture.jwk],
      ['missing kid', tokenWith({ header: { alg: 'RS256' } }), fixture.jwk],
      ['wrong nonce width', tokenWith({ payload: { ...payload, nonce: 'AA' } }), fixture.jwk],
      [
        'wrong claim type',
        tokenWith({ payload: { ...payload, exp: String(payload.exp) } }),
        fixture.jwk,
      ],
      [
        'unverified email',
        tokenWith({ payload: { ...payload, email_verified: false } }),
        fixture.jwk,
      ],
      ['short signature', tokenWith({ signature: new Uint8Array(255) }), fixture.jwk],
      [
        'missing canonical claim spelling',
        tokenWithPayload(payloadJson.replace('"email":"', '"email": "')),
        fixture.jwk,
      ],
      [
        'missing structural terminator',
        tokenWithPayload(payloadJson.replace('","email_verified"', '" ,"email_verified"')),
        fixture.jwk,
      ],
      ['wrong key id', fixture.idToken, { ...fixture.jwk, kid: 'other' }],
      ['wrong exponent', fixture.idToken, { ...fixture.jwk, e: 'Aw' }],
      [
        'short modulus',
        fixture.idToken,
        { ...fixture.jwk, n: Buffer.alloc(255, 0xff).toString('base64url') },
      ],
    ]
    for (const [name, token, jwk] of cases) {
      expect(() => buildGoogleWitness(token, jwk), name).toThrow()
    }
  })

  it('does not require optional JWK metadata', () => {
    const { kid, kty, e, n } = fixture.jwk
    const jwk = { kid, kty, e, n }
    expect(buildGoogleWitness(fixture.idToken, jwk)).toEqual(
      buildGoogleWitness(fixture.idToken, fixture.jwk),
    )
  })

  it('rejects wrong-length, wrong-order, wrong-type, and one-byte-changed public inputs', () => {
    const { proofFields } = buildGoogleWitness(fixture.idToken, fixture.jwk)
    const proof = { identityProof: new Uint8Array([1]), ...proofFields }
    expect(validateGooglePublicInputs(BB_PUBLIC_INPUTS, digest, proof)).toBe(true)
    expect(validateGooglePublicInputs(BB_PUBLIC_INPUTS.slice(1), digest, proof)).toBe(false)
    const reordered = [...BB_PUBLIC_INPUTS]
    const first = reordered[0]
    reordered[0] = reordered[1]
    reordered[1] = first
    expect(validateGooglePublicInputs(reordered, digest, proof)).toBe(false)
    const mistyped: unknown[] = [...BB_PUBLIC_INPUTS]
    mistyped[0] = 0xb3
    expect(validateGooglePublicInputs(mistyped, digest, proof)).toBe(false)
    const changed = [...BB_PUBLIC_INPUTS]
    changed[55] = `${changed[55].slice(0, -2)}bc`
    expect(validateGooglePublicInputs(changed, digest, proof)).toBe(false)
  })
})
