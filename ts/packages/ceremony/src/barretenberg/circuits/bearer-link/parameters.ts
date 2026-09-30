import { COMMITMENT_BYTES } from '../../../notary/protocol.js'

/** Fixed bearer_link ABI in libid-circuits v0.5.0. */
export const MAX_BEARER_BYTES = 128
// One public field per byte of each of the token and identity commitments.
export const PUBLIC_INPUT_COUNT = 2 * COMMITMENT_BYTES
