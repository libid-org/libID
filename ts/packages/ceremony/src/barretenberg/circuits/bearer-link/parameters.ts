import { PLATFORM_X } from '@libid/contracts/platforms'

/** Fixed bearer_link ABI in libid-circuits v0.7.1; changes require a matching circuit/key release. */
export const MAX_BEARER_BYTES = 128
/** The id and handle buffers: X's platform table entry, which GitHub's equals. */
export const MAX_ID_BYTES = PLATFORM_X.idRules.maxLength
export const MAX_HANDLE_BYTES = PLATFORM_X.rules.maxLength
/** A tag is one public field: its bytes from the top of 31 bytes, zero after. */
export const MAX_TAG_BYTES = 31
/** Four commitments and two nodes as `[high, low]` halves, then each tag and its length. */
export const PUBLIC_INPUT_COUNT = 6 * 2 + 2 * 2
