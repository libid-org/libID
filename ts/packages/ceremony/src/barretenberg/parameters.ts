/** bb.js 6.0.0-rc.2 settings for verifierTarget: 'evm' (ZK-Honk/Keccak), shared with build checks. */
export const PROVING_SETTINGS = {
  ipaAccumulation: false,
  oracleHashType: 'keccak',
  disableZk: false,
  optimizedSolidityVerifier: false,
} as const

/** Serialized field representation; unrelated to the width of a byte-packed circuit input. */
export const FIELD_BYTES = 32
const FIELD_HEX_DIGITS = FIELD_BYTES * 2
export const FIELD_HEX_CHARS = '0x'.length + FIELD_HEX_DIGITS
export const FIELD_HEX_PATTERN = new RegExp(`^0x[0-9a-f]{${FIELD_HEX_DIGITS}}$`)

/** Canonical public field spelling used by both circuit adapters. */
export const fieldHex = (value: bigint | number): string =>
  `0x${BigInt(value).toString(16).padStart(FIELD_HEX_DIGITS, '0')}`

/** Bytes as one unsigned big-endian integer. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

/** Bytes in one 32-byte value's half. */
const HALF_BYTES = 16

/** A 32-byte hash or node as both circuits take it: `[high, low]` big-endian 16-byte fields. */
export const halves = (value: Uint8Array): bigint[] => [
  bytesToBigInt(value.subarray(0, HALF_BYTES)),
  bytesToBigInt(value.subarray(HALF_BYTES)),
]

/** bb.js browser CRS loader uses 4 MiB chunks of compressed G1 points. */
export const G1_POINT_BYTES = 32
export const CRS_CHUNK_BYTES = 4 * 1024 * 1024
export const MIN_SRS_POINTS = CRS_CHUNK_BYTES / G1_POINT_BYTES
// One shared SRS covers both released circuits; build/circuits.ts checks their capacity.
export const SRS_POINTS = 2 ** 18
export const G2_BYTES = 128
export const GRUMPKIN_POINT_BYTES = 64
export const GRUMPKIN_SRS_POINTS = 2 ** 16
