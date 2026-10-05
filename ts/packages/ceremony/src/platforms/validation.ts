import { recordValidator } from '../primitives.js'
import type { PlatformId } from './index.js'

/** Browser acceptance cap on opaque ZK proof bytes, not a circuit dimension. */
const MAX_PROOF_BYTES = 4 * 1024 * 1024

/** One platform user; the wire form is `Identity<string>` until a platform slice checks it. */
export interface Identity<P extends string = PlatformId> {
  platformId: P
  oauthClientId: string
  userId: string
  userName: string
}

/** A nonzero decimal u64 user ID, as X and GitHub number their users. */
const MAX_U64 = 0xffffffffffffffffn
const MAX_U64_CHARS = MAX_U64.toString().length
export const decimalUserId = {
  maxBytes: MAX_U64_CHARS,
  valid: (value: string): boolean =>
    value.length <= MAX_U64_CHARS && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= MAX_U64,
}

export const isProofBytes = (v: unknown): v is Uint8Array =>
  v instanceof Uint8Array && v.length > 0 && v.length <= MAX_PROOF_BYTES

const stringWhere = (valid: (value: string) => boolean) => (value: unknown) =>
  typeof value === 'string' && valid(value)

/** The platform's literal ID plus one encoding predicate per string field. */
export const identityValidator = <P extends string>(
  platform: P,
  valid: Record<'oauthClientId' | 'userId' | 'userName', (value: string) => boolean>,
) =>
  recordValidator<Identity<P>>(`Invalid ${platform} identity`, {
    platformId: (value) => value === platform,
    oauthClientId: stringWhere(valid.oauthClientId),
    userId: stringWhere(valid.userId),
    userName: stringWhere(valid.userName),
  })
