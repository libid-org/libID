import {
  buildOidcPublicInputs,
  OIDC_PUBLIC_INPUT_COUNT,
  RSA_MODULUS_BYTES,
} from '../barretenberg/circuits/oidc.js'
import { FIELD_HEX_CHARS, FIELD_HEX_PATTERN } from '../barretenberg/parameters.js'
import { identityNodes, isAccountId, isHandle } from '../identity.js'
import { isFixedBytes, isUint, type Predicates } from '../primitives.js'
import { type Identity, identityValidator, isProofBytes } from './validation.js'

/** A proof in the OIDC circuits' public-input layout, less the signed time each platform names. */
export interface OidcProofFields {
  identityProof: Uint8Array
  /** Exact circuit fields: lowercase, 0x-prefixed, 32-byte hex values. */
  publicInputs: readonly string[]
  signingKeyModulus: Uint8Array
}

/** Shape checks of the shared proof fields. */
export const oidcProofFields: Predicates<OidcProofFields> = {
  identityProof: isProofBytes,
  publicInputs: (value: unknown) =>
    Array.isArray(value) &&
    value.length === OIDC_PUBLIC_INPUT_COUNT &&
    Array.from(value).every(
      (field) =>
        typeof field === 'string' &&
        field.length === FIELD_HEX_CHARS &&
        FIELD_HEX_PATTERN.test(field),
    ),
  signingKeyModulus: (value: unknown) => isFixedBytes(value, RSA_MODULUS_BYTES),
}

/** A signed time the circuit binds. */
export const isSignedTime = (value: unknown) => isUint(value, Number.MAX_SAFE_INTEGER)

/** A signed `aud` the circuit binds: printable ASCII without quotes, so length is the byte length. */
export const isAudience = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[\x20-\x21\x23-\x7e]+$/.test(value)

/** Identity and proof checks for one platform's OIDC circuit. */
export function oidcValidation<
  P extends string,
  Signed,
  Proof extends OidcProofFields & Signed,
>(options: {
  platform: P
  name: string
  proofShape: (value: unknown) => Proof
  /** The signed time the proof's public inputs bind. */
  signedTime: (proof: Signed) => number
  maxAudBytes: number
}) {
  const { platform, name, proofShape, signedTime, maxAudBytes } = options
  type Bound = Signed & Pick<OidcProofFields, 'signingKeyModulus'>

  /** Client identifier constraints: what a signed `aud` can hold. */
  const isClientId = (value: unknown): value is string => isAudience(value, maxAudBytes)

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
      signedTime: signedTime(proof),
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
