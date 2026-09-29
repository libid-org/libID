import { hasExactKeys, isRecord } from '../primitives.js'
import type { PlatformId } from './index.js'

export interface Identity<P extends PlatformId = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

export const proofBytes = (v: unknown): v is Uint8Array =>
  v instanceof Uint8Array && v.length > 0 && v.length <= 4 * 1024 * 1024

const IDENTITY_FIELDS = ['oauthClientId', 'userId', 'userName'] as const

/** Exact shape plus one encoding predicate per string field. */
export function isIdentity<P extends PlatformId>(
  v: unknown,
  platform: P,
  valid: Record<(typeof IDENTITY_FIELDS)[number], (value: string) => boolean>,
): v is Identity<P> {
  return (
    isRecord(v) &&
    hasExactKeys(v, ['platformId', ...IDENTITY_FIELDS]) &&
    v.platformId === platform &&
    IDENTITY_FIELDS.every((key) => {
      const value = v[key]
      return typeof value === 'string' && valid[key](value)
    })
  )
}

export const isUserId = (value: string): boolean =>
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn
