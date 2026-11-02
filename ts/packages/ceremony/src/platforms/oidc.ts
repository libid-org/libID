import { type Asset, assetUrl } from '../assets/index.js'
import { RSA_EXPONENT_BASE64URL, RSA_MODULUS_BYTES } from '../barretenberg/circuits/oidc.js'
import { ProofEngine } from '../barretenberg/engine.js'
import { operation } from '../events.js'
import { b64urlDecode, isRecord } from '../primitives.js'
import { fetchPublicJson } from '../response.js'
import type { ProverContext } from './context.js'
import type { PlatformId } from './index.js'
import type { Identity } from './validation.js'

/** Bound a public JWKS response independently of any circuit's token dimensions. */
const MAX_JWKS_BYTES = 128 * 1024

/** One OIDC request's budget, above the Bridge's own upstream timeout. */
export const REQUEST_TIMEOUT_MS = 15000

/** The run's signal, also aborted once one request outlasts its budget. */
export const requestSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])

const text = new TextDecoder('utf-8', { fatal: true })

/** Decode a JWT segment's JSON object, or null. */
function jsonObject(bytes: Uint8Array | null): Record<string, unknown> | null {
  try {
    const value: unknown = bytes && JSON.parse(text.decode(bytes))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** The `kid` of an RS256 JWT header, or null. */
const rs256Kid = (header: Record<string, unknown> | null): string | null =>
  header?.alg === 'RS256' && typeof header.kid === 'string' && header.kid !== '' ? header.kid : null

/** The segments, decoded bytes, payload claims and `kid` of a three-part RS256 JWT, or null. */
export function parseRs256Jwt(idToken: string) {
  const segments = idToken.split('.')
  if (segments.length !== 3 || segments.includes('')) return null
  const [headerB64, payloadB64, signatureB64] = segments
  const payload = b64urlDecode(payloadB64)
  const signature = b64urlDecode(signatureB64)
  const header = jsonObject(b64urlDecode(headerB64))
  const claims = jsonObject(payload)
  return payload && signature && header && claims
    ? { headerB64, payloadB64, payload, signature, claims, kid: rs256Kid(header) }
    : null
}

/** Select the one key carrying `kid` from the key set at `url`, read under `cache`. */
export async function fetchSigningKey(
  url: string,
  kid: string,
  signal: AbortSignal,
  cache: RequestCache = 'default',
): Promise<unknown> {
  // A run closed before this point starts no key request.
  signal.throwIfAborted()
  const body = await fetchPublicJson(
    url,
    MAX_JWKS_BYTES,
    'Signing key request failed',
    requestSignal(signal),
    cache,
  )
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('Invalid key set')
  const keys = body.keys.filter((k) => isRecord(k) && k.kid === kid)
  if (keys.length !== 1) throw new Error('Signing key is not unique')
  return keys[0]
}

/** The RSA-2048, e = 65537 modulus of `jwk`, checked against a 256-byte `signature`. */
export function rs256Modulus(jwk: unknown, signature: Uint8Array | null): Uint8Array {
  if (!isRecord(jwk) || jwk.kty !== 'RSA' || jwk.e !== RSA_EXPONENT_BASE64URL)
    throw new Error('JWK is not an RS256 signing key')
  const modulus = typeof jwk.n === 'string' ? b64urlDecode(jwk.n) : null
  if (modulus?.length !== RSA_MODULUS_BYTES || (modulus[0] & 0x80) === 0)
    throw new Error('Signing key must be RSA-2048')
  if (signature?.length !== RSA_MODULUS_BYTES) throw new Error('Signature must be 256 bytes')
  return modulus
}

/**
 * Prove an OIDC identity: start the engine, take the accepted token, fetch its signing key, build
 * the circuit inputs, prove, and check the public inputs against the delivered identity.
 */
export async function proveOidc<
  P extends PlatformId,
  T extends { kid: string },
  F extends { signingKeyModulus: Uint8Array },
>(
  context: ProverContext<P>,
  oidc: {
    name: string
    assets: { circuit: Asset; verificationKey: Asset }
    token(): T | Promise<T>
    fetchSigningKey(kid: string, signal: AbortSignal): Promise<unknown>
    prepare(
      token: T,
      jwk: unknown,
    ): {
      inputs: Record<string, unknown>
      authorizationDigest: Uint8Array
      identity: Identity<P>
      proofFields: F
    }
    isPublicInputs(
      value: unknown,
      authorizationDigest: Uint8Array,
      identity: Identity<P>,
      proof: F,
    ): boolean
  },
) {
  const { signal, emit } = context
  const engine = new ProofEngine({
    circuitUrl: assetUrl(oidc.assets.circuit),
    verificationKeyUrl: assetUrl(oidc.assets.verificationKey),
    emit,
  })
  try {
    const token = await oidc.token()
    const key = await operation(emit, 'signing-key-fetch', () =>
      oidc.fetchSigningKey(token.kid, signal),
    )
    const { inputs, authorizationDigest, identity, proofFields } = await operation(
      emit,
      'circuit-inputs',
      () => oidc.prepare(token, key),
    )
    const raw = await engine.prove(inputs, signal)
    const proof = { identityProof: raw.proof, publicInputs: raw.publicInputs, ...proofFields }
    if (!oidc.isPublicInputs(raw.publicInputs, authorizationDigest, identity, proof))
      throw new Error(`${oidc.name} public input mismatch`)
    return { identity, proof }
  } finally {
    engine.destroy()
  }
}
