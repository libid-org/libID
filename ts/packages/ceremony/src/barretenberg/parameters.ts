/** bb.js 5.2.0 settings for verifierTarget: 'evm' (ZK-Honk/Keccak), shared with build checks. */
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

/** bb.js browser CRS loader uses 4 MiB chunks of compressed G1 points. */
export const G1_POINT_BYTES = 32
export const CRS_CHUNK_BYTES = 4 * 1024 * 1024
export const MIN_SRS_POINTS = CRS_CHUNK_BYTES / G1_POINT_BYTES
// One shared SRS covers both released circuits; build/circuits.ts checks their capacity.
export const SRS_POINTS = 2 ** 18
export const G2_BYTES = 128
export const GRUMPKIN_POINT_BYTES = 64
export const GRUMPKIN_SRS_POINTS = 2 ** 16
