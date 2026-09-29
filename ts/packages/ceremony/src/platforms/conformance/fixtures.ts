// The platform conformance table: one typed entry per catalog platform. Adding a platform to
// the catalog fails typecheck here until its entry exists; conformance.test.ts then runs the
// catalog, OAuth return, validator and pipeline checks over every entry.
import { readFileSync } from 'node:fs'
import type { OAuthReturn } from '../../ccdp/navigation.js'
import { LIBID_RS_ATTESTED_DATA } from '../../notary/fixtures/libid-rs.js'
import { b64urlDecode, b64urlEncode } from '../../primitives.js'
import type { BearerTranscript } from '../bearer-transcript.js'
import type { ProverContext } from '../context.js'
import * as githubTranscript from '../github/1/transcript.js'
import * as githubTypes from '../github/1/types.js'
import * as googleTypes from '../google/1/types.js'
import type { PlatformId, ProofByPlatformVersion, platforms } from '../index.js'
import type { ReturnProfile } from '../oauthReturn.js'
import type { Identity } from '../types.js'
import * as xTranscript from '../x/1/transcript.js'
import * as xTypes from '../x/1/types.js'

type Proof<P extends PlatformId> = ProofByPlatformVersion[P] extends { 1: infer T } ? T : never

type IdentityField = 'oauthClientId' | 'userId' | 'userName'

/** Bridge configuration; the catalog flag decides whether the public credential is required. */
type ClientConfig<P extends PlatformId> = { clientId: string } & ((typeof platforms)[P] extends {
  requiresClientCredential: true
}
  ? { clientCredential: string }
  : { clientCredential?: string })

/** One provider redirect per outcome, bound to the given OAuth state. */
export interface ReturnSamples {
  accepted: { oauthReturn: OAuthReturn; credential: string }
  denied: { oauthReturn: OAuthReturn }
  error: { oauthReturn: OAuthReturn; error: string }
}

type Claim<P extends PlatformId> = { identity: Identity<P>; proof: Proof<P> }

interface Entry<P extends PlatformId> {
  config: ClientConfig<P>
  /** The return rules the platform must enforce, declared here rather than read from its profile. */
  oauthReturn: ReturnProfile
  /** The identity the pipeline evidence names; `oauthClientId` is the configured client. */
  identity: Identity<P>
  /** Every identity field at its maximum accepted length. */
  longest: Identity<P>
  /** Platform-specific encodings each identity field rejects, beyond the shared cases. */
  rejectedIdentity: { [K in IdentityField]: readonly string[] }
  /** Client IDs admitted beyond the fixture's, such as form-reserved text a signed audience carries. */
  admittedClientIds: readonly string[]
  /** A structurally valid delivered proof, bound to `identity` and `digest`. */
  proof: Proof<P>
  /** The client authorization digest `proof` is bound to. */
  digest: Uint8Array
  /** Retention expiry the result adapter derives from `proof`, computed independently here. */
  expiresAt: number
  /** The platform version's own validators, which the catalog's result adapter composes. */
  types: {
    validateIdentity(value: unknown): Identity<P>
    validateProof(value: unknown, identity: Identity<P>, authorizationDigest: Uint8Array): Proof<P>
  }
  /** Out-of-bound values each proof field rejects. */
  rejectedProof: { [K in keyof Proof<P>]-?: readonly unknown[] }
  /** Weighted operations the pipeline adds to the proof engine's own. */
  operations: readonly string[]
  /** Normative platform test IDs, as title tags, that each conformance section covers here. */
  specTests: { identity: string; returns: string; issuer: string; pipeline: string }
  returns(state: string): ReturnSamples
  /** The execution leaf, lazily imported as the Prover dispatcher imports it. */
  prover(): Promise<{
    prove(context: ProverContext): Promise<{ identity: Identity<P>; proof: Proof<P> } | null>
  }>
}

/** Code-exchange platforms proven by two notarized HTTP transcripts and the bearer-link circuit. */
export interface BearerLinkFixture<P extends PlatformId> extends Entry<P> {
  pipeline: 'bearer-link'
  transcript: BearerTranscript
  evidence: {
    bearer: string
    /** Token endpoint body carrying `bearer`. */
    tokenBody: string
    /** Identity endpoint body naming `identity`. */
    identityBody: string
    /** The same identity values outside the profile's response shape. */
    misshapenIdentityBody: string
  }
}

/** Implicit-flow platforms proven from a signed ID token and its published signing key. */
export interface OidcFixture<P extends PlatformId> extends Entry<P> {
  pipeline: 'oidc'
  evidence: {
    idToken: string
    jwk: Record<string, string>
    /** The digest the token nonce carries. */
    authorizationDigest: Uint8Array
    /** Verifier fields bb.js produced for exactly this token and key. */
    publicInputs: readonly string[]
  }
  /** Well-formed changes that bind the claim to another authorization, identity or signing key. */
  rejectedBinding: Record<string, (claim: Claim<P>) => Claim<P>>
}

export type PlatformFixture<P extends PlatformId> = BearerLinkFixture<P> | OidcFixture<P>

const decoder = new TextDecoder()

const encoder = new TextEncoder()

/** Decode one JWT segment's JSON. */
export const jwtPart = (jwt: string, index: 0 | 1): Record<string, unknown> =>
  JSON.parse(decoder.decode(b64urlDecode(jwt.split('.')[index])!))

/** Re-encode a JWT with replaced segments; a string payload is used verbatim. Nothing is re-signed. */
export function jwtWith(
  jwt: string,
  change: {
    header?: Record<string, unknown>
    payload?: Record<string, unknown> | string
    signature?: Uint8Array
  },
): string {
  const [header, payload, signature] = jwt.split('.')
  const encode = (value: Record<string, unknown> | string) =>
    b64urlEncode(encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)))
  return [
    change.header ? encode(change.header) : header,
    change.payload ? encode(change.payload) : payload,
    change.signature ? b64urlEncode(change.signature) : signature,
  ].join('.')
}

const googleFixture = JSON.parse(
  readFileSync(new URL('../google/1/google-v1.fixture.json', import.meta.url), 'utf8'),
) as { idToken: string; jwk: Record<string, string>; authorizationDigest: string }

/** The Google v1 RS256 token, its signing JWK and the §5 digest its nonce carries. */
export const googleV1 = {
  idToken: googleFixture.idToken,
  jwk: googleFixture.jwk,
  authorizationDigest: Uint8Array.from(
    googleFixture.authorizationDigest.match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
  ),
}

// Generated once by running googleV1 through the official libid-circuits
// v0.3.0 oidc_google ACIR and bb.js 5.2.0, not by this adapter.
export const googlePublicInputs = [
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

const googleClaims = jwtPart(googleV1.idToken, 1) as { aud: string; sub: string; email: string }

const googleModulus = b64urlDecode(googleV1.jwk.n)!

/** `field` with its low bit flipped: still canonical, but a different value. */
const flipped = (field: string) => `0x${(BigInt(field) ^ 1n).toString(16).padStart(64, '0')}`

/** One byte past the delivered proof bound. */
const oversizedProof = new Uint8Array(4 * 1024 * 1024 + 1)

const bearer = 'fixture_BEARER-123'

const userId = '9007199254740993' // Above Number.MAX_SAFE_INTEGER.

const bearerLinkOperations = [
  'token-fetch',
  'token-attestation',
  'identity-fetch',
  'identity-attestation',
]

const bearerLinkSpecTests = {
  identity: '[TEST-PLAT-02]',
  returns: '[TEST-PLAT-18]',
  pipeline: '[TEST-PLAT-15A] [TEST-PLAT-15B] [TEST-PLAT-17A] [TEST-PLAT-21]',
}

/** Form-authenticated client IDs whose serialization would change the frozen request bytes. */
const formSerializationChanges = ['a+b', 'a b', 'a%2Fb']

const decimalIdViolations = ['0', '01', '18446744073709551616', '-1', '1.5', '1e3']

const attestation = (byte: number) => ({
  attestedData: LIBID_RS_ATTESTED_DATA.slice(),
  signature: new Uint8Array(65).fill(byte),
})

/** The pinned attestation's u64 creation time (after its 32-byte authority) plus the launch lifetime. */
const bearerExpiresAt = Number(new DataView(LIBID_RS_ATTESTED_DATA.buffer).getBigUint64(32)) + 3600

const bearerDigest = new Uint8Array(32).fill(5)

const bearerLinkProof = () => ({
  bearerLinkProof: new Uint8Array([1]),
  tokenAttestation: attestation(1),
  identityAttestation: attestation(2),
})

const rejectedAttestations = [
  { attestedData: new Uint8Array(), signature: new Uint8Array(65) },
  { attestedData: new Uint8Array(2 * 1024 * 1024 + 1), signature: new Uint8Array(65) },
  { attestedData: new Uint8Array([1]), signature: new Uint8Array(64) },
  { attestedData: new Uint8Array([1]), signature: new Uint8Array(66) },
  { signature: new Uint8Array(65) },
  { ...attestation(1), extra: 1 },
]

const bearerLinkRejectedProof = {
  bearerLinkProof: [new Uint8Array(), oversizedProof],
  tokenAttestation: rejectedAttestations,
  identityAttestation: rejectedAttestations,
}

/** A query code return; `suffix` carries any issuer field the profile requires. */
const codeReturns =
  (suffix = '', denialDetail = '', error = 'server_error') =>
  (state: string): ReturnSamples => ({
    accepted: {
      oauthReturn: { query: `?code=fixture&state=${state}${suffix}`, fragment: '' },
      credential: 'fixture',
    },
    denied: {
      oauthReturn: {
        query: `?error=access_denied${denialDetail}&state=${state}${suffix}`,
        fragment: '',
      },
    },
    error: {
      oauthReturn: { query: `?error=${error}&state=${state}${suffix}`, fragment: '' },
      error,
    },
  })

export const fixtures = {
  google: {
    pipeline: 'oidc',
    config: { clientId: googleClaims.aud },
    oauthReturn: {
      transport: 'fragment',
      credential: 'id_token',
      rejected: ['code', 'access_token', 'refresh_token'],
    },
    identity: {
      platformId: 'google',
      oauthClientId: googleClaims.aud,
      userId: googleClaims.sub,
      userName: googleClaims.email,
    },
    longest: {
      platformId: 'google',
      oauthClientId: 'a'.repeat(128),
      userId: '1'.repeat(31),
      userName: `${'a'.repeat(50)}@example.com`,
    },
    // The shared quote, control and non-ASCII cases are exactly what circuit text excludes.
    rejectedIdentity: { oauthClientId: [], userId: [], userName: [] },
    admittedClientIds: ['a+b'],
    proof: {
      identityProof: new Uint8Array([1]),
      tokenExpiresAt: jwtPart(googleV1.idToken, 1).exp as number,
      signingKeyModulus: googleModulus,
      publicInputs: googlePublicInputs,
    },
    digest: googleV1.authorizationDigest,
    expiresAt: jwtPart(googleV1.idToken, 1).exp as number,
    types: googleTypes,
    rejectedProof: {
      identityProof: [new Uint8Array(), oversizedProof],
      tokenExpiresAt: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1],
      signingKeyModulus: [googleModulus.slice(1), new Uint8Array(257)],
      // Wrong count, holes or noncanonical field encodings; binding is `rejectedBinding`.
      publicInputs: [
        [],
        googlePublicInputs.slice(1),
        [...googlePublicInputs, googlePublicInputs[0]],
        new Array(56),
        ...[
          0,
          null,
          '0x00',
          '00'.repeat(32),
          `0X${'00'.repeat(32)}`,
          `0x${'AA'.repeat(32)}`,
          `0x${'gg'.repeat(32)}`,
          `${googlePublicInputs[0]}\n`,
        ].map((field) => [field, ...googlePublicInputs.slice(1)]),
      ],
    },
    operations: ['signing-key-fetch'],
    specTests: {
      identity: '[TEST-PLAT-02]',
      returns: '[TEST-PLAT-03] [TEST-PLAT-05]',
      issuer: '',
      pipeline: '[TEST-PLAT-06]',
    },
    returns: (state) => ({
      accepted: {
        oauthReturn: { query: '', fragment: `#state=${state}&id_token=${googleV1.idToken}` },
        credential: googleV1.idToken,
      },
      denied: { oauthReturn: { query: '', fragment: `#state=${state}&error=access_denied` } },
      error: {
        oauthReturn: { query: '', fragment: `#state=${state}&error=server_error` },
        error: 'server_error',
      },
    }),
    prover: () => import('../google/1/prover.js'),
    evidence: { ...googleV1, publicInputs: googlePublicInputs },
    rejectedBinding: {
      'authorization digest': ({ identity, proof }) => ({
        identity,
        proof: {
          ...proof,
          publicInputs: [flipped(proof.publicInputs[0]), ...proof.publicInputs.slice(1)],
        },
      }),
      audience: ({ identity, proof }) => ({
        identity: { ...identity, oauthClientId: 'other' },
        proof,
      }),
      subject: ({ identity, proof }) => ({ identity: { ...identity, userId: '2' }, proof }),
      email: ({ identity, proof }) => ({
        identity: { ...identity, userName: 'b@example.com' },
        proof,
      }),
      'token expiry': ({ identity, proof }) => ({
        identity,
        proof: { ...proof, tokenExpiresAt: proof.tokenExpiresAt + 1 },
      }),
      'signing-key modulus': ({ identity, proof }) => {
        const signingKeyModulus = proof.signingKeyModulus.slice()
        signingKeyModulus[0] ^= 1
        return { identity, proof: { ...proof, signingKeyModulus } }
      },
      'public-input order': ({ identity, proof }) => {
        const publicInputs = [...proof.publicInputs]
        ;[publicInputs[34], publicInputs[35]] = [publicInputs[35], publicInputs[34]]
        return { identity, proof: { ...proof, publicInputs } }
      },
    },
  },
  x: {
    pipeline: 'bearer-link',
    config: { clientId: 'client' },
    oauthReturn: {
      transport: 'query',
      credential: 'code',
      rejected: ['id_token', 'access_token', 'refresh_token', 'iss'],
    },
    identity: { platformId: 'x', oauthClientId: 'client', userId, userName: 'alice' },
    longest: {
      platformId: 'x',
      oauthClientId: 'a'.repeat(512),
      userId: '18446744073709551615',
      userName: 'a'.repeat(15),
    },
    rejectedIdentity: {
      oauthClientId: formSerializationChanges,
      userId: decimalIdViolations,
      userName: ['a-b', 'a.b'],
    },
    admittedClientIds: [],
    proof: bearerLinkProof(),
    digest: bearerDigest,
    expiresAt: bearerExpiresAt,
    types: xTypes,
    rejectedProof: bearerLinkRejectedProof,
    operations: bearerLinkOperations,
    specTests: { ...bearerLinkSpecTests, issuer: '[TEST-PLAT-18]' },
    returns: codeReturns(),
    prover: () => import('../x/1/prover.js'),
    transcript: xTranscript,
    evidence: {
      bearer,
      tokenBody: `{ "access_token" : "${bearer}", "token_type": "bearer" }`,
      identityBody: `{ "data": { "username": "alice", "id": "${userId}" } }`,
      misshapenIdentityBody: `{ "login": "alice", "other": { "id": "${userId}", "username": "alice" } }`,
    },
  },
  github: {
    pipeline: 'bearer-link',
    config: { clientId: 'client', clientCredential: 'public-fixture' },
    oauthReturn: {
      transport: 'query',
      credential: 'code',
      rejected: ['id_token', 'access_token', 'refresh_token'],
      issuer: 'https://github.com/login/oauth',
    },
    identity: { platformId: 'github', oauthClientId: 'client', userId, userName: 'alice' },
    longest: {
      platformId: 'github',
      oauthClientId: 'a'.repeat(512),
      userId: '18446744073709551615',
      userName: 'a'.repeat(39),
    },
    rejectedIdentity: {
      oauthClientId: formSerializationChanges,
      userId: decimalIdViolations,
      userName: ['a_b', 'a--b', '-a', 'a-'],
    },
    admittedClientIds: [],
    proof: bearerLinkProof(),
    digest: bearerDigest,
    expiresAt: bearerExpiresAt,
    types: githubTypes,
    rejectedProof: bearerLinkRejectedProof,
    operations: bearerLinkOperations,
    specTests: { ...bearerLinkSpecTests, issuer: '[LIBID-OAUTH-031] [TEST-PLAT-12A]' },
    returns: codeReturns(
      `&iss=${encodeURIComponent('https://github.com/login/oauth')}`,
      '&error_description=Access+denied&error_uri=%2Fhelp',
      'application_suspended',
    ),
    prover: () => import('../github/1/prover.js'),
    transcript: githubTranscript,
    evidence: {
      bearer,
      tokenBody: `{ "access_token" : "${bearer}", "token_type": "bearer" }`,
      identityBody: `{ "login" : "alice", "id" : ${userId} , "unused": true }`,
      misshapenIdentityBody: `{ "login": "alice", "other": { "id": ${userId}, "username": "alice" } }`,
    },
  },
} satisfies { [P in PlatformId]: PlatformFixture<P> }
