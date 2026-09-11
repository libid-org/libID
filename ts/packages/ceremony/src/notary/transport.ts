import { parseJson } from '../json.js'
import { hasExactKeys, isRecord, origin } from '../primitives.js'
import { MAX_ATTESTED_DATA_BYTES } from './decode.js'

export const MAX_FRAME_BYTES = 10 * 1024 * 1024

export const MAX_FRAME_PAYLOAD_BYTES = MAX_FRAME_BYTES - 4

export interface NotaryAttestation {
  attestedData: Uint8Array
  signature: Uint8Array
}

function invalid(reason: string): never {
  throw new Error(`invalid notary transport: ${reason}`)
}

export function deriveNotaryWebSocketUrl(notaryAddress: string): string {
  if (!origin(notaryAddress)) invalid('address must be a canonical HTTPS or localhost HTTP origin')
  const url = new URL(notaryAddress)
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/notarize-proxy`
}

function validateByteArray(value: unknown, maximum: number): asserts value is number[] {
  if (!Array.isArray(value) || value.length > maximum) invalid('invalid byte array')
  for (const byte of value) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) invalid('invalid byte element')
  }
}

/** Decode one complete, EOF-delimited frame emitted by notary PR #6. */
export function decodeAttestationFrame(frame: Uint8Array): NotaryAttestation {
  if (frame.length < 4) invalid('truncated length')
  const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0)
  if (length > MAX_FRAME_PAYLOAD_BYTES) invalid('payload exceeds size limit')
  if (frame.length < length + 4) invalid('truncated payload')
  if (frame.length > length + 4) invalid('trailing bytes')

  let value: unknown
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(4))
    value = parseJson(text)
  } catch {
    return invalid('malformed JSON payload')
  }
  if (!isRecord(value) || !hasExactKeys(value, ['attested_data', 'notary_signature'])) {
    invalid('payload must contain exactly attested_data and notary_signature')
  }
  if (!Array.isArray(value.notary_signature) || value.notary_signature.length !== 65) {
    invalid('notary signature must be exactly 65 bytes')
  }
  const attestedData = value.attested_data
  const signature = value.notary_signature
  validateByteArray(attestedData, MAX_ATTESTED_DATA_BYTES)
  validateByteArray(signature, 65)
  return {
    attestedData: Uint8Array.from(attestedData),
    signature: Uint8Array.from(signature),
  }
}
