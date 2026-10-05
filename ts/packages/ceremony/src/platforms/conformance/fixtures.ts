// The platform conformance table: one typed entry per catalog platform. Adding a platform to
// the catalog fails typecheck here until its entry exists; the conformance suites beside this
// file then run the catalog, OAuth return, validator and prover checks over every entry.
import { readFileSync } from 'node:fs'
import type { OAuthReturn } from '../../ccdp/navigation.js'
import { LIBID_RS_ATTESTED_DATA } from '../../notary/fixtures/libid-rs.js'
import type { IdentityRequest } from '../../notary/oauth/identity.js'
import type { TokenRequest, TokenRequestInput } from '../../notary/oauth/token.js'
import { b64urlDecode, b64urlEncode } from '../../primitives.js'
import { identity as githubIdentity } from '../github/1/identity.js'
import { token as githubToken } from '../github/1/token.js'
import * as githubValidation from '../github/1/validation.js'
import * as googleValidation from '../google/1/validation.js'
import type { PlatformId, ProofByPlatformVersion, platforms } from '../index.js'
import type { ReturnRules } from '../oauthReturn.js'
import type { ProverModule } from '../provers.js'
import type { Identity } from '../validation.js'
import { identity as xIdentity } from '../x/1/identity.js'
import { token as xToken } from '../x/1/token.js'
import * as xValidation from '../x/1/validation.js'

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

/** The values one authorization request carries; `codeChallenge` is null without PKCE. */
export interface AuthorizationRequestInput {
  clientId: string
  redirectUri: string
  state: string
  authorizationDigest: Uint8Array
  codeChallenge: string | null
}

interface Entry<P extends PlatformId> {
  config: ClientConfig<P>
  /** The authorization endpoint and query fields, in order, its spec table requires for `input`. */
  authorizationRequest: {
    url: string
    fields(input: AuthorizationRequestInput): [string, string][]
  }
  /** The return rules the platform must enforce, declared here rather than read from its `url.ts`. */
  returnRules: ReturnRules
  /** The identity the evidence names; `oauthClientId` is the configured client. */
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
  validation: {
    validateIdentity(value: unknown): Identity<P>
    validateProof(value: unknown, identity: Identity<P>, authorizationDigest: Uint8Array): Proof<P>
  }
  /** Out-of-bound values each proof field rejects. */
  rejectedProof: { [K in keyof Proof<P>]-?: readonly unknown[] }
  /** Weighted operations the prover adds to the proof engine's own. */
  operations: readonly string[]
  /** Normative platform test IDs, as title tags, that each conformance section covers here. */
  specTests: { identity: string; returns: string; issuer: string; prover: string }
  returns(state: string): ReturnSamples
  /** The execution leaf, imported independently of the Prover's dispatch table. */
  prover(): Promise<ProverModule<P>>
}

/** Code-flow platforms proven by two notarized HTTP transcripts and, last, the bearer-link circuit. */
export interface NotarizedFixture<P extends PlatformId> extends Entry<P> {
  proverKind: 'notarized'
  requests: { token: TokenRequest; identity: IdentityRequest }
  /** The token endpoint and the form fields, in order, the platform must send for `input`. */
  tokenRequest: { url: string; form(input: TokenRequestInput): [string, string][] }
  /** The identity endpoint and the headers it pins beside Host, Authorization and Connection. */
  identityRequest: { url: string; headers: Record<string, string> }
  /** Normative test IDs the token and identity transcript sections tag for this platform. */
  transcriptTests: { token: string; identity: string }
  evidence: {
    bearer: string
    /** Token endpoint body carrying `bearer`. */
    tokenBody: string
    /** Identity endpoint body naming `identity`. */
    identityBody: string
    /** The exact identity members `identityBody` discloses, in body order. */
    identityMembers: readonly string[]
    /** The same identity with its members in another order, and the exact members it discloses. */
    reorderedIdentityBody: string
    reorderedIdentityMembers: readonly string[]
    /** The same identity values outside the platform's response shape. */
    misshapenIdentityBody: string
  }
}

/** Implicit-flow platforms proven from a signed ID token and its published signing key. */
export interface OidcFixture<P extends PlatformId> extends Entry<P> {
  proverKind: 'oidc'
  evidence: {
    idToken: string
    jwk: Record<string, string>
    /** The digest the token nonce carries. */
    authorizationDigest: Uint8Array
    /** Verifier fields bb.js produced for exactly this token and key. */
    publicInputs: readonly string[]
    /** The circuit input that carries the authorization digest. */
    digestInput: string
    /** The published key with only the members the prover requires. */
    minimalJwk: Record<string, string>
  }
  /** Well-formed changes that bind the claim to another authorization, identity or signing key. */
  rejectedBinding: Record<string, (claim: Claim<P>) => Claim<P>>
  /** Token or published-key rewrites the prover rejects before proving; tags follow the name. */
  rejectedEvidence: Record<string, EvidenceChange>
}

/** A rewrite of the signed token, the published signing key, or both, and the operation that rejects it. */
export interface EvidenceChange {
  idToken?: (idToken: string) => string
  jwk?: (jwk: Record<string, string>) => Record<string, string>
  /** `authorization` rejects before any key fetch or engine start. */
  rejectedAt: 'authorization' | 'signing-key-fetch' | 'circuit-inputs'
  /** The refusal's text, where the prover names its cause. */
  message?: string
}

export type PlatformFixture<P extends PlatformId> = NotarizedFixture<P> | OidcFixture<P>

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
// v0.5.0 oidc_google ACIR and bb.js 5.2.0, not by this adapter; v0.6.0 with
// bb.js 6.0.0-rc.2 yields the same values.
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
  '0x0000000000000000000000000000000020078023c9d4bf6bffc2580ec3644607',
  '0x000000000000000000000000000000005d10c8453cecbe4f1cb3d326b2b35560',
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

/** A token whose claim JSON is rewritten as text, keeping its header and signature. */
const payloadText = (idToken: string, change: (json: string) => string) =>
  jwtWith(idToken, { payload: change(decoder.decode(b64urlDecode(idToken.split('.')[1])!)) })

/** A token claiming `exp` as given. */
const expiry = (exp: unknown): EvidenceChange => ({
  idToken: (idToken) => jwtWith(idToken, { payload: { ...jwtPart(idToken, 1), exp } }),
  rejectedAt: 'authorization',
})

/** How the runtime refuses identifiers the circuit cannot hold, before the key fetch. */
const circuitRefusal =
  'Google account identifiers exceed the lengths or characters the circuit supports'

/** A token claiming `sub` as given, refused with `message`. */
const subject = (sub: string, message = circuitRefusal): EvidenceChange => ({
  idToken: (idToken) => jwtWith(idToken, { payload: { ...jwtPart(idToken, 1), sub } }),
  rejectedAt: 'authorization',
  message,
})

/** `field` with its low bit flipped: still canonical, but a different value. */
const flipped = (field: string) => `0x${(BigInt(field) ^ 1n).toString(16).padStart(64, '0')}`

/** One byte past the delivered proof bound. */
const oversizedProof = new Uint8Array(4 * 1024 * 1024 + 1)

const bearer = 'fixture_BEARER-123'

const userId = '9007199254740993' // Above Number.MAX_SAFE_INTEGER.

const notarizedOperations = [
  'token-fetch',
  'token-attestation',
  'identity-fetch',
  'identity-attestation',
]

const notarizedSpecTests = {
  identity: '[TEST-PLAT-02]',
  returns: '[TEST-PLAT-18]',
  prover: '[TEST-PLAT-15A] [TEST-PLAT-15B] [TEST-PLAT-17A] [TEST-PLAT-21]',
}

/** Form-authenticated client IDs whose serialization would change the frozen request bytes. */
const formSerializationChanges = ['a+b', 'a b', 'a%2Fb']

const decimalIdViolations = ['0', '01', '18446744073709551616', '-1', '1.5', '1e3', '1 2', '"1"']

const attestation = (byte: number) => ({
  attestedData: LIBID_RS_ATTESTED_DATA.slice(),
  signature: new Uint8Array(65).fill(byte),
})

/** The pinned attestation's u64 creation time (after its 32-byte authority) plus the launch lifetime. */
const bearerExpiresAt = Number(new DataView(LIBID_RS_ATTESTED_DATA.buffer).getBigUint64(32)) + 3600

const bearerDigest = new Uint8Array(32).fill(5)

const notarizedProof = () => ({
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

const notarizedRejectedProof = {
  bearerLinkProof: [new Uint8Array(), oversizedProof],
  tokenAttestation: rejectedAttestations,
  identityAttestation: rejectedAttestations,
}

/** A query code return; `suffix` carries any issuer field the rules require. */
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
    proverKind: 'oidc',
    config: { clientId: googleClaims.aud },
    returnRules: {
      transport: 'fragment',
      credentialField: 'id_token',
      rejected: ['code', 'access_token', 'refresh_token'],
    },
    identity: {
      platformId: 'google',
      oauthClientId: googleClaims.aud,
      // The platform-ceremonies §2.1 userId of the token's `sub`.
      userId: '0x20078023c9d4bf6bffc2580ec36446075d10c8453cecbe4f1cb3d326b2b35560',
      userName: googleClaims.email,
    },
    longest: {
      platformId: 'google',
      oauthClientId: 'a'.repeat(128),
      userId: `0x${'f'.repeat(64)}`,
      userName: `${'a'.repeat(50)}@example.com`,
    },
    // Circuit text excludes exactly the shared quote, control and non-ASCII cases. A userId is
    // only the lowercase digest spelling, never the `sub` itself.
    rejectedIdentity: {
      oauthClientId: [],
      userId: [
        googleClaims.sub,
        `0x${'A'.repeat(64)}`,
        `0X${'a'.repeat(64)}`,
        'a'.repeat(66),
        `0x${'a'.repeat(63)}`,
      ],
      userName: [],
    },
    admittedClientIds: ['a+b'],
    proof: {
      identityProof: new Uint8Array([1]),
      tokenExpiresAt: jwtPart(googleV1.idToken, 1).exp as number,
      signingKeyModulus: googleModulus,
      publicInputs: googlePublicInputs,
    },
    digest: googleV1.authorizationDigest,
    expiresAt: jwtPart(googleV1.idToken, 1).exp as number,
    validation: googleValidation,
    rejectedProof: {
      identityProof: [new Uint8Array(), oversizedProof],
      tokenExpiresAt: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1],
      signingKeyModulus: [googleModulus.slice(1), new Uint8Array(257)],
      // Wrong count, holes or noncanonical field encodings; binding is `rejectedBinding`.
      publicInputs: [
        [],
        googlePublicInputs.slice(1),
        [...googlePublicInputs, googlePublicInputs[0]],
        new Array(57),
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
      prover: '[TEST-PLAT-06]',
    },
    authorizationRequest: {
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
      fields: (input) => [
        ['response_type', 'id_token'],
        ['response_mode', 'fragment'],
        ['client_id', input.clientId],
        ['redirect_uri', input.redirectUri],
        ['scope', 'openid email'],
        ['state', input.state],
        ['nonce', b64urlEncode(input.authorizationDigest)],
      ],
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
    evidence: {
      ...googleV1,
      publicInputs: googlePublicInputs,
      digestInput: 'authorization_digest',
      // RS256 needs only the key ID, type, exponent and modulus.
      minimalJwk: {
        kid: googleV1.jwk.kid,
        kty: googleV1.jwk.kty,
        e: googleV1.jwk.e,
        n: googleV1.jwk.n,
      },
    },
    rejectedEvidence: {
      'a non-RS256 algorithm': {
        idToken: (idToken) =>
          jwtWith(idToken, { header: { ...jwtPart(idToken, 0), alg: 'ES256' } }),
        rejectedAt: 'authorization',
      },
      'a missing key ID': {
        idToken: (idToken) => jwtWith(idToken, { header: { alg: 'RS256' } }),
        rejectedAt: 'authorization',
      },
      'an email beyond the circuit width': {
        idToken: (idToken) =>
          jwtWith(idToken, {
            payload: { ...jwtPart(idToken, 1), email: `${'a'.repeat(53)}@gmail.com` },
          }),
        rejectedAt: 'authorization',
        message: circuitRefusal,
      },
      'a nonce of the wrong width': {
        idToken: (idToken) =>
          jwtWith(idToken, { payload: { ...jwtPart(idToken, 1), nonce: 'AA' } }),
        rejectedAt: 'circuit-inputs',
      },
      'a short signature': {
        idToken: (idToken) => jwtWith(idToken, { signature: new Uint8Array(255) }),
        rejectedAt: 'circuit-inputs',
      },
      'a noncanonical claim spelling': {
        idToken: (idToken) =>
          payloadText(idToken, (json) => json.replace('"email":"', '"email": "')),
        rejectedAt: 'circuit-inputs',
      },
      'a missing structural terminator': {
        idToken: (idToken) =>
          payloadText(idToken, (json) => json.replace('","email_verified"', '" ,"email_verified"')),
        rejectedAt: 'circuit-inputs',
      },
      // The circuit discloses the email as the user name, so an unverified one never proves.
      'an unverified email': {
        idToken: (idToken) =>
          jwtWith(idToken, { payload: { ...jwtPart(idToken, 1), email_verified: false } }),
        rejectedAt: 'authorization',
      },
      // Only the userId hash leaves the circuit, which rejects these; the runtime refuses them first.
      'an empty sub': subject('', 'invalid Google ID token'),
      'a quote in the sub [REQ-PLAT-16C]': subject('a"b'),
      'a control byte in the sub [REQ-PLAT-16C]': subject('a\x1fb'),
      'a delete byte in the sub [REQ-PLAT-16C]': subject('a\x7fb'),
      'a non-ASCII sub [REQ-PLAT-16C]': subject('é'),
      'a sub over 31 bytes [REQ-PLAT-16C]': subject('1'.repeat(32)),
      'a fractional expiry [TEST-COMMON-12]': expiry(1.5),
      'a negative expiry [TEST-COMMON-12]': expiry(-1),
      'an unrepresentable expiry [TEST-COMMON-12]': expiry(2 ** 64),
      'a string expiry [TEST-COMMON-12]': expiry('1725001000'),
      'a non-65537 exponent': { jwk: (jwk) => ({ ...jwk, e: 'Aw' }), rejectedAt: 'circuit-inputs' },
      'a short modulus': {
        jwk: (jwk) => ({ ...jwk, n: b64urlEncode(new Uint8Array(255).fill(0xff)) }),
        rejectedAt: 'circuit-inputs',
      },
    },
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
      'user ID': ({ identity, proof }) => ({
        identity: { ...identity, userId: flipped(identity.userId) },
        proof,
      }),
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
    proverKind: 'notarized',
    config: { clientId: 'client' },
    returnRules: {
      transport: 'query',
      credentialField: 'code',
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
    proof: notarizedProof(),
    digest: bearerDigest,
    expiresAt: bearerExpiresAt,
    validation: xValidation,
    rejectedProof: notarizedRejectedProof,
    operations: notarizedOperations,
    specTests: { ...notarizedSpecTests, issuer: '[TEST-PLAT-18]' },
    authorizationRequest: {
      url: 'https://x.com/i/oauth2/authorize',
      fields: (input) => [
        ['response_type', 'code'],
        ['client_id', input.clientId],
        ['redirect_uri', input.redirectUri],
        ['scope', 'tweet.read users.read'],
        ['state', input.state],
        ['code_challenge', String(input.codeChallenge)],
        ['code_challenge_method', 'S256'],
      ],
    },
    returns: codeReturns(),
    prover: () => import('../x/1/prover.js'),
    requests: { token: xToken, identity: xIdentity },
    tokenRequest: {
      url: 'https://api.x.com/2/oauth2/token',
      form: (input) => [
        ['grant_type', 'authorization_code'],
        ['client_id', input.clientId],
        ['code', input.code],
        ['redirect_uri', input.redirectUri],
        ['code_verifier', input.codeVerifier],
      ],
    },
    identityRequest: {
      url: 'https://api.x.com/2/users/me',
      headers: { Accept: 'application/json' },
    },
    transcriptTests: {
      token:
        '[LIBID-PROVER-003] [REQ-PLAT-56A] [REQ-PLAT-56B] [REQ-PLAT-56C] [TEST-PLAT-09A] [TEST-PLAT-09B] [TEST-PLAT-09C]',
      identity: '[LIBID-PROVER-003]',
    },
    evidence: {
      bearer,
      tokenBody: `{ "access_token" : "${bearer}", "token_type": "bearer" }`,
      identityBody: `{ "data": { "username": "alice", "id": "${userId}" } }`,
      identityMembers: ['"username": "alice"', `"id": "${userId}"`],
      reorderedIdentityBody: `{ "data": { "id": "${userId}", "username": "alice" } }`,
      reorderedIdentityMembers: [`"id": "${userId}"`, '"username": "alice"'],
      misshapenIdentityBody: `{ "login": "alice", "other": { "id": "${userId}", "username": "alice" } }`,
    },
  },
  github: {
    proverKind: 'notarized',
    config: { clientId: 'client', clientCredential: 'public-fixture' },
    returnRules: {
      transport: 'query',
      credentialField: 'code',
      rejected: ['id_token', 'access_token', 'refresh_token'],
      authorizationIssuer: 'https://github.com/login/oauth',
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
    proof: notarizedProof(),
    digest: bearerDigest,
    expiresAt: bearerExpiresAt,
    validation: githubValidation,
    rejectedProof: notarizedRejectedProof,
    operations: notarizedOperations,
    specTests: { ...notarizedSpecTests, issuer: '[LIBID-OAUTH-031] [TEST-PLAT-12A]' },
    authorizationRequest: {
      url: 'https://github.com/login/oauth/authorize',
      fields: (input) => [
        ['client_id', input.clientId],
        ['redirect_uri', input.redirectUri],
        ['scope', 'read:user'],
        ['state', input.state],
        ['code_challenge', String(input.codeChallenge)],
        ['code_challenge_method', 'S256'],
      ],
    },
    returns: codeReturns(
      `&iss=${encodeURIComponent('https://github.com/login/oauth')}`,
      '&error_description=Access+denied&error_uri=%2Fhelp',
      'application_suspended',
    ),
    prover: () => import('../github/1/prover.js'),
    requests: { token: githubToken, identity: githubIdentity },
    tokenRequest: {
      url: 'https://github.com/login/oauth/access_token',
      form: (input) => [
        ['client_id', input.clientId],
        ['code', input.code],
        ['redirect_uri', input.redirectUri],
        ['code_verifier', input.codeVerifier],
        ['client_secret', input.clientCredential ?? ''],
      ],
    },
    identityRequest: {
      url: 'https://api.github.com/user',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Mozilla/5.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    transcriptTests: {
      token: '[LIBID-PROVER-004] [TEST-PLAT-12] [TEST-PLAT-14]',
      identity: '[LIBID-PROVER-004] [REQ-PLAT-60] [TEST-PLAT-22]',
    },
    evidence: {
      bearer,
      tokenBody: `{ "access_token" : "${bearer}", "token_type": "bearer" }`,
      identityBody: `{ "login" : "alice", "id" : ${userId} , "unused": true }`,
      // A numeric ID discloses its whitespace and the delimiter that ends it: a comma or a brace.
      identityMembers: ['"login" : "alice"', `"id" : ${userId} ,`],
      reorderedIdentityBody: `{ "unused": true, "login" : "alice", "id" : ${userId} }`,
      reorderedIdentityMembers: ['"login" : "alice"', `"id" : ${userId} }`],
      misshapenIdentityBody: `{ "login": "alice", "other": { "id": ${userId}, "username": "alice" } }`,
    },
  },
} satisfies { [P in PlatformId]: PlatformFixture<P> }
