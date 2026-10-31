import { buildOidcPublicInputs, RSA_MODULUS_BYTES } from '../barretenberg/circuits/oidc.js'
import { FIELD_HEX_CHARS, FIELD_HEX_PATTERN } from '../barretenberg/parameters.js'
import { identityNodes, isAccountId, isHandle } from '../identity.js'
import { isFixedBytes, isUint, type Predicates, recordValidator } from '../primitives.js'
import { type Identity, identityValidator, isProofBytes } from './validation.js'

/** A proof in the OIDC circuits' public-input layout; `T` names the signed time it binds. */
export type OidcProof<T extends string> = {
  identityProof: Uint8Array
  /** Exact circuit fields: lowercase, 0x-prefixed, 32-byte hex values. */
  publicInputs: readonly string[]
  signingKeyModulus: Uint8Array
} & { [K in T]: number }

/** A signed `aud` the circuit binds: printable ASCII without quotes, so length is the byte length. */
export const isAudience = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[\x20-\x21\x23-\x7e]+$/.test(value)

/** Identity and proof checks for one platform's OIDC circuit. */
export function oidcValidation<P extends string, T extends string>(options: {
  platform: P
  name: string
  timeField: T
  publicInputCount: number
  maxAudBytes: number
}) {
  const { platform, name, timeField, publicInputCount, maxAudBytes } = options
  type Proof = OidcProof<T>
  type Bound = Pick<Proof, T | 'signingKeyModulus'>

  /** Client identifier constraints: what a signed `aud` can hold. */
  const isClientId = (value: unknown): value is string => isAudience(value, maxAudBytes)

  const proofShape = recordValidator<Proof>(`Invalid ${name} proof`, {
    identityProof: isProofBytes,
    publicInputs: (value: unknown) =>
      Array.isArray(value) &&
      value.length === publicInputCount &&
      Array.from(value).every(
        (field) =>
          typeof field === 'string' &&
          field.length === FIELD_HEX_CHARS &&
          FIELD_HEX_PATTERN.test(field),
      ),
    [timeField]: (value: unknown) => isUint(value, Number.MAX_SAFE_INTEGER),
    signingKeyModulus: (value: unknown) => isFixedBytes(value, RSA_MODULUS_BYTES),
  } as unknown as Predicates<Proof>)

  /** Flatten the validated identity and proof values into the circuit's public fields. */
  const buildPublicInputs = (
    authorizationDigest: Uint8Array,
    identity: Identity<P>,
    proof: Bound,
  ): string[] =>
    buildOidcPublicInputs({
      authorizationDigest,
      audience: identity.oauthClientId,
      ...identityNodes(identity),
      signedTime: (proof as Record<T, number>)[timeField],
      modulus: proof.signingKeyModulus,
    })

  /** Compare every circuit field in order; canonical hex makes string equality byte equality. */
  function isPublicInputs(
    value: unknown,
    authorizationDigest: Uint8Array,
    identity: Identity<P>,
    proof: Bound,
  ): value is string[] {
    if (!Array.isArray(value)) return false
    const expected = buildPublicInputs(authorizationDigest, identity, proof)
    return (
      value.length === expected.length && expected.every((item, index) => item === value[index])
    )
  }

  return {
    isClientId,
    buildPublicInputs,
    isPublicInputs,
    /** Check the payload and bind its public inputs to the client's validated identity and digest. */
    validateProof(value: unknown, identity: Identity<P>, authorizationDigest: Uint8Array): Proof {
      const proof = proofShape(value)
      if (!isPublicInputs(proof.publicInputs, authorizationDigest, identity, proof))
        throw new Error(`${name} public input mismatch`)
      return proof
    },
    validateIdentity: identityValidator(platform, {
      oauthClientId: isClientId,
      userId: (s) => isAccountId(platform, s),
      userName: (s) => isHandle(platform, s),
    }),
  }
}
