// The token check and node keys of platform-ceremonies §2.1 and §2.1a, from @libid/contracts:
// its platform table carries the tags, buffers and id shapes libID-circuits ships.
import {
  checkId,
  HandleError,
  handleNode as handleNodeHex,
  IdError,
  idNode as idNodeHex,
  normalize,
  type Platform,
  platform,
} from '@libid/contracts/platforms'
import { hexToBytes } from '@noble/hashes/utils.js'

/** A binding's two keys: the id node and the handle node, 32 bytes each. */
export interface IdentityNodes {
  idNode: Uint8Array
  handleNode: Uint8Array
}

/** The platform table's entry for a platform key: its tags and the circuits' buffers. */
export function platformTable(key: string): Platform {
  const entry = platform(key)
  if (entry === undefined) throw new Error(`No platform table entry for ${key}`)
  return entry
}

/** Whether a circuit admits `value` as this platform's handle: one JSON string as sent, within its buffer. */
export function isHandle(key: string, value: string): boolean {
  try {
    normalize(value, platformTable(key).rules)
    return true
  } catch (error) {
    if (error instanceof HandleError) return false
    throw error
  }
}

/** Whether a circuit admits `value` as this platform's account id, exactly as the platform sent it. */
export function isAccountId(key: string, value: string): boolean {
  try {
    checkId(key, value)
    return true
  } catch (error) {
    if (error instanceof IdError) return false
    throw error
  }
}

/** REQ-PLAT-05A: `SHA256(user-id tag || id)`, the id unchanged, as bytes. Throws for an id no circuit hashes. */
export function idNode(key: string, id: string): Uint8Array {
  return hexToBytes(idNodeHex(key, id).slice(2))
}

/** REQ-PLAT-05B: `SHA256(handle tag || fold(handle))`, as bytes. Throws for a handle no circuit hashes. */
export function handleNode(key: string, handle: string): Uint8Array {
  return hexToBytes(handleNodeHex(key, handle).slice(2))
}
