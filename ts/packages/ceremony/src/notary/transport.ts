import { hasExactKeys, isOrigin, isUint } from '../primitives.js'
import type { NotaryAttestation } from './decode.js'
import { MAX_ATTESTED_DATA_BYTES, MAX_FRAME_BYTES } from './limits.js'
import { NOTARY_SIGNATURE_BYTES } from './protocol.js'

const FRAME_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT
const MAX_FRAME_PAYLOAD_BYTES = MAX_FRAME_BYTES - FRAME_LENGTH_BYTES

function invalid(reason: string): never {
  throw new Error(`invalid notary transport: ${reason}`)
}

export function deriveNotaryWebSocketUrl(notaryAddress: string): string {
  if (!isOrigin(notaryAddress))
    invalid('address must be a canonical HTTPS or localhost HTTP origin')
  const url = new URL(notaryAddress)
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/notarize-proxy`
}

function byteArray(value: unknown, minimum: number, maximum: number, reason: string): Uint8Array {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(reason)
  if (!value.every((byte) => isUint(byte, 255))) invalid('invalid byte element')
  return Uint8Array.from(value)
}

/**
 * Decode the reclaimed-channel record: u32 big-endian JSON byte length, then UTF-8 JSON.
 * The channel reader requires EOF; trailing bytes, extra records and malformed byte arrays reject.
 */
export function decodeAttestationFrame(frame: Uint8Array): NotaryAttestation {
  if (frame.length < FRAME_LENGTH_BYTES) invalid('truncated length')
  const length = new DataView(frame.buffer, frame.byteOffset, FRAME_LENGTH_BYTES).getUint32(0)
  if (length > MAX_FRAME_PAYLOAD_BYTES) invalid('payload exceeds size limit')
  if (frame.length < length + FRAME_LENGTH_BYTES) invalid('truncated payload')
  if (frame.length > length + FRAME_LENGTH_BYTES) invalid('trailing bytes')

  let value: unknown
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(FRAME_LENGTH_BYTES)),
    )
  } catch {
    return invalid('malformed JSON payload')
  }
  if (!hasExactKeys(value, ['attested_data', 'notary_signature'])) {
    invalid('payload must contain exactly attested_data and notary_signature')
  }
  const signature = byteArray(
    value.notary_signature,
    NOTARY_SIGNATURE_BYTES,
    NOTARY_SIGNATURE_BYTES,
    'notary signature must be exactly 65 bytes',
  )
  // Empty attested data is never a signed record; the delivered-attestation check agrees.
  return {
    attestedData: byteArray(value.attested_data, 1, MAX_ATTESTED_DATA_BYTES, 'invalid byte array'),
    signature,
  }
}
