import { recordValidator } from '../primitives.js'
import type { PlatformId } from './index.js'

/** Browser acceptance cap on opaque ZK proof bytes, not a circuit dimension. */
const MAX_PROOF_BYTES = 4 * 1024 * 1024

/** X/GitHub identifiers are nonzero decimal u64 values. */
const MAX_USER_ID = 0xffffffffffffffffn
export const MAX_USER_ID_CHARS = MAX_USER_ID.toString().length

export interface Identity<P extends PlatformId = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

export const proofBytes = (v: unknown): v is Uint8Array =>
  v instanceof Uint8Array && v.length > 0 && v.length <= MAX_PROOF_BYTES

const stringWhere = (valid: (value: string) => boolean) => (value: unknown) =>
  typeof value === 'string' && valid(value)

/** The platform's literal ID plus one encoding predicate per string field. */
export const identityValidator = <P extends PlatformId>(
  platform: P,
  valid: Record<'oauthClientId' | 'userId' | 'userName', (value: string) => boolean>,
) =>
  recordValidator<Identity<P>>(`Invalid ${platform} identity`, {
    platformId: (value) => value === platform,
    oauthClientId: stringWhere(valid.oauthClientId),
    userId: stringWhere(valid.userId),
    userName: stringWhere(valid.userName),
  })

export const isUserId = (value: string): boolean =>
  value.length <= MAX_USER_ID_CHARS && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= MAX_USER_ID
