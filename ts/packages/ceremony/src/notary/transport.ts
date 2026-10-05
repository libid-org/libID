import { concatBytes } from '@noble/hashes/utils.js'
import { hasExactKeys, isOrigin, isUint } from '../primitives.js'
import { MAX_ATTESTED_DATA_BYTES, MAX_FRAME_BYTES } from './limits.js'
import { NOTARY_SIGNATURE_BYTES, type NotaryAttestation } from './protocol.js'
import type { Io } from './tlsn.js'

const FRAME_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT
const MAX_FRAME_PAYLOAD_BYTES = MAX_FRAME_BYTES - FRAME_LENGTH_BYTES

function invalid(reason: string): never {
  throw new Error(`Invalid notary transport: ${reason}`)
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

export function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
  const listening = new AbortController()
  const signal = listening.signal
  return new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error('Notary WebSocket failed to open'))
    socket.addEventListener('open', () => resolve(), { signal })
    socket.addEventListener('error', failed, { signal })
    socket.addEventListener('close', failed, { signal })
  }).finally(() => listening.abort())
}

export function socketIo(socket: WebSocket): Io {
  const chunks: Uint8Array[] = []
  const readers: PromiseWithResolvers<Uint8Array | null>[] = []
  // The first error or close ends reading once buffered chunks drain; later events are ignored.
  let end: { error: Error | null } | undefined

  const settle = (error: Error | null) => {
    if (end) return
    end = { error }
    for (const reader of readers.splice(0)) {
      if (error) reader.reject(error)
      else reader.resolve(null)
    }
  }

  socket.binaryType = 'arraybuffer'
  socket.addEventListener('message', (event) => {
    if (end) return
    if (!(event.data instanceof ArrayBuffer))
      return settle(new Error('Notary sent non-binary data'))
    const chunk = new Uint8Array(event.data)
    const reader = readers.shift()
    if (reader) reader.resolve(chunk)
    else chunks.push(chunk)
  })
  socket.addEventListener('error', () => settle(new Error('Notary WebSocket failed')))
  socket.addEventListener('close', () => settle(null))

  return {
    read() {
      const chunk = chunks.shift()
      if (chunk) return Promise.resolve(chunk)
      if (end) return end.error ? Promise.reject(end.error) : Promise.resolve(null)
      const reader = Promise.withResolvers<Uint8Array | null>()
      readers.push(reader)
      return reader.promise
    },
    write(data) {
      // The pinned SDK catches synchronous throws but discards write promises.
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('Notary WebSocket is not open')
      }
      // WebSocket.send rejects views of shared memory, so copy only those.
      socket.send(
        data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : data.slice(),
      )
      return Promise.resolve()
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      return Promise.resolve()
    },
  }
}

export async function readFinalFrame(io: Io): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for (let chunk = await io.read(); chunk !== null; chunk = await io.read()) {
    length += chunk.length
    if (length > MAX_FRAME_BYTES) throw new Error('Notary attestation frame exceeds size limit')
    chunks.push(chunk)
  }
  return concatBytes(...chunks)
}
