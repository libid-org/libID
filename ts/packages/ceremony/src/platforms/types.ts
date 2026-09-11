import { hasExactKeys, isRecord, text } from '../primitives.js'
import type { PlatformId } from './index.js'

export interface Identity<P extends PlatformId = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

export const proofBytes = (v: unknown): v is Uint8Array =>
  v instanceof Uint8Array && v.length > 0 && v.length <= 4 * 1024 * 1024

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

export const isUserId = (value: string): boolean =>
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn
