import type { Platform } from '@libid/contracts/platforms'
import { handleNode, idNode } from '../../../identity.js'
import type { HashOpening } from '../../../notary/notarize.js'
import { bytesToBigInt, fieldHex, halves } from '../../parameters.js'
import {
  MAX_BEARER_BYTES,
  MAX_HANDLE_BYTES,
  MAX_ID_BYTES,
  MAX_TAG_BYTES,
  PUBLIC_INPUT_COUNT,
} from './parameters.js'

const encoder = new TextEncoder()

/** A circuit-width HTTP bearer: visible ASCII, so no whitespace. */
export const isBearer = (value: string): boolean =>
  value.length <= MAX_BEARER_BYTES && /^[\x21-\x7e]+$/.test(value)

/** A committed identity value and the opening of its commitment. */
export interface OpenedValue {
  value: string
  opening: HashOpening
}

/**
 * What bearer_link opens: the bearer under the token response's and the identity request's
 * commitments, and the identity response's id and handle under theirs. Openings come from
 * plaintextOpening, which fixes their blinder width and value length.
 */
export interface BearerLinkWitness {
  bearer: string
  token: HashOpening
  identity: HashOpening
  id: OpenedValue
  handle: OpenedValue
}

/** `value` zero-padded to its circuit buffer. */
function padded(value: string, buffer: number, name: string): number[] {
  const bytes = encoder.encode(value)
  if (bytes.length > buffer)
    throw new Error(`The ${name} exceeds its ${buffer}-byte circuit buffer`)
  const out = new Uint8Array(buffer)
  out.set(bytes)
  return Array.from(out)
}

/** A tag as one public field: its bytes from the top of 31 bytes, zero after. */
function packedTag(tag: string): bigint {
  const bytes = encoder.encode(tag)
  if (bytes.length === 0 || bytes.length > MAX_TAG_BYTES)
    throw new Error('Tag does not fit a field')
  const out = new Uint8Array(MAX_TAG_BYTES)
  out.set(bytes)
  return bytesToBigInt(out)
}

const hex = (value: bigint) => `0x${value.toString(16)}`

/**
 * The exact libid-circuits v0.7.1 `bearer_link` circuit inputs under `platform`'s tags. The nodes
 * are REQ-PLAT-05A and REQ-PLAT-05B over the opened id and handle; a value no circuit admits throws.
 */
export function buildBearerLinkInputs(platform: Platform, witness: BearerLinkWitness) {
  const { bearer, token, identity, id, handle } = witness
  if (!isBearer(bearer))
    throw new Error(`Bearer must be 1 to ${MAX_BEARER_BYTES} visible ASCII bytes`)
  const ids = idNode(platform.key, id.value)
  const handles = handleNode(platform.key, handle.value)
  const field = (value: Uint8Array) => halves(value).map(hex)
  return {
    bearer: padded(bearer, MAX_BEARER_BYTES, 'bearer'),
    bearer_len: String(encoder.encode(bearer).length),
    blinder_token: Array.from(token.blinder),
    blinder_identity: Array.from(identity.blinder),
    id: padded(id.value, MAX_ID_BYTES, 'id'),
    id_len: String(encoder.encode(id.value).length),
    blinder_id: Array.from(id.opening.blinder),
    handle: padded(handle.value, MAX_HANDLE_BYTES, 'handle'),
    handle_len: String(encoder.encode(handle.value).length),
    blinder_handle: Array.from(handle.opening.blinder),
    token_commitment: field(token.hash),
    identity_commitment: field(identity.hash),
    id_commitment: field(id.opening.hash),
    handle_commitment: field(handle.opening.hash),
    id_node: field(ids),
    handle_node: field(handles),
    id_tag: hex(packedTag(platform.userIdTag)),
    id_tag_len: String(encoder.encode(platform.userIdTag).length),
    handle_tag: hex(packedTag(platform.handleTag)),
    handle_tag_len: String(encoder.encode(platform.handleTag).length),
  }
}

/** The 16 public fields, in circuit order, of the inputs a proof was requested for. */
export function bearerLinkPublicInputs(inputs: ReturnType<typeof buildBearerLinkInputs>): string[] {
  return [
    ...inputs.token_commitment,
    ...inputs.identity_commitment,
    ...inputs.id_commitment,
    ...inputs.handle_commitment,
    ...inputs.id_node,
    ...inputs.handle_node,
    inputs.id_tag,
    inputs.id_tag_len,
    inputs.handle_tag,
    inputs.handle_tag_len,
  ].map((value) => fieldHex(BigInt(value)))
}

/** Match every public field in the circuit's exact order. */
export function isBearerLinkPublicInputs(
  value: readonly string[],
  inputs: ReturnType<typeof buildBearerLinkInputs>,
): boolean {
  const expected = bearerLinkPublicInputs(inputs)
  return (
    expected.length === PUBLIC_INPUT_COUNT &&
    value.length === PUBLIC_INPUT_COUNT &&
    value.every((v, i) => v === expected[i])
  )
}
