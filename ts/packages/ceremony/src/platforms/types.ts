import { text, uint } from '../ccdp/index.js'
import type { DecodedAttestedData, DecodedDirection } from '../notary/decode.js'
import { hasExactKeys, isRecord } from '../primitives.js'
import type { PlatformId } from './index.js'

export type { DecodedAttestedData, DecodedDirection } from '../notary/decode.js'

export interface Identity<P extends PlatformId = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

export interface NotaryAttestation {
  attestedData: Uint8Array
  signature: Uint8Array
  decoded: DecodedAttestedData
}

export const proofBytes = (v: unknown): v is Uint8Array =>
  v instanceof Uint8Array && v.length > 0 && v.length <= 4 * 1024 * 1024

export const fixedBytes = (v: unknown, n: number): v is Uint8Array =>
  v instanceof Uint8Array && v.length === n

export function isIdentity<P extends PlatformId>(
  v: unknown,
  platform: P,
  limits = [512, 255, 255],
): v is Identity<P> {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['platformId', 'oauthClientId', 'userId', 'userName']) &&
    v.platformId === platform &&
    text(v.oauthClientId, limits[0]) &&
    text(v.userId, limits[1]) &&
    text(v.userName, limits[2])
  )
}

function direction(v: unknown): v is DecodedDirection {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['revealed', 'commitments']) &&
    Array.isArray(v.revealed) &&
    v.revealed.length <= 65536 &&
    Array.isArray(v.commitments) &&
    v.commitments.length <= 65536 &&
    v.revealed.every(
      (r) =>
        isRecord(r) &&
        hasExactKeys(r, ['start', 'bytes']) &&
        uint(r.start, 0xffffffff) &&
        r.bytes instanceof Uint8Array &&
        r.bytes.length <= 32768,
    ) &&
    v.commitments.every(
      (r) =>
        isRecord(r) &&
        hasExactKeys(r, ['start', 'end', 'commitment']) &&
        uint(r.start, 0xffffffff) &&
        uint(r.end, 0xffffffff) &&
        fixedBytes(r.commitment, 32),
    )
  )
}

export function isAttestation(v: unknown): v is NotaryAttestation {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['attestedData', 'signature', 'decoded']) ||
    !(v.attestedData instanceof Uint8Array) ||
    !v.attestedData.length ||
    v.attestedData.length > 2 * 1024 * 1024 ||
    !fixedBytes(v.signature, 65)
  )
    return false
  const d = v.decoded
  return (
    isRecord(d) &&
    hasExactKeys(d, [
      'authorityId',
      'createdAt',
      'sentTranscriptLength',
      'receivedTranscriptLength',
      'sent',
      'received',
    ]) &&
    fixedBytes(d.authorityId, 32) &&
    typeof d.createdAt === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(d.createdAt) &&
    BigInt(d.createdAt) <= 0xffffffffffffffffn &&
    uint(d.sentTranscriptLength, 4096) &&
    uint(d.receivedTranscriptLength, 32768) &&
    direction(d.sent) &&
    direction(d.received)
  )
}

export const isUserId = (value: string): boolean =>
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn
