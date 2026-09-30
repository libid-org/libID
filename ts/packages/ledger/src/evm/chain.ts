import { keccak_256 } from '@noble/hashes/sha3.js'
import { hexToBytes } from '@noble/hashes/utils.js'

/**
 * The Chain Profile hash of an `eip155:<chain id>` identifier, or `null` if it is not one.
 * Matches `keccak256(abi.encode(block.chainid))` in the ceremony verifier contracts.
 */
export function chainHash(chain: string): Uint8Array | null {
  const reference = /^eip155:([1-9][0-9]{0,31})$/.exec(chain)?.[1]
  return reference ? keccak_256(hexToBytes(BigInt(reference).toString(16).padStart(64, '0'))) : null
}

export const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)
