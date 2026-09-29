import type { Message, MessageType } from '@libid/popup'
import { MAX_MESSAGE_BYTES } from '../errors.js'
import { type OperationEvent, validateEvent } from '../events.js'
import { isPkceValue, MAX_CEREMONY_VERSION } from '../platforms/authorization.js'
import {
  hasExactKeys,
  isRecord,
  isSlug,
  origin,
  type Predicates,
  recordValidator,
  text,
  uint,
  webUrl,
} from '../primitives.js'
import {
  MAX_CLIENT_CREDENTIAL_BYTES,
  MAX_CLIENT_ID_BYTES,
  MAX_IDENTITY_TEXT_BYTES,
  MAX_REDIRECT_URI_BYTES,
} from './limits.js'

/** Pure CCDP codecs: shape and bounds validation only; transport authentication belongs to popup. */
export const CCDP_VERSION = 1

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Public OAuth application credential: bounded like clientId, without whitespace or control bytes. */
export const isClientCredential = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_CLIENT_CREDENTIAL_BYTES &&
  /^[\x21-\x7e]+$/.test(value)

export function redirect(value: unknown): value is string {
  return text(value, MAX_REDIRECT_URI_BYTES) && webUrl(value) && !/[?#]/.test(value)
}

/** Shared identity shape; each platform slice checks its own platform ID and byte limits. */
function isIdentityShape(value: unknown): value is IdentityProof['identity'] {
  return (
    hasExactKeys(value, ['platformId', 'oauthClientId', 'userId', 'userName']) &&
    isSlug(value.platformId) &&
    text(value.oauthClientId, MAX_CLIENT_ID_BYTES) &&
    text(value.userId, MAX_IDENTITY_TEXT_BYTES) &&
    text(value.userName, MAX_IDENTITY_TEXT_BYTES)
  )
}

type Fields<M extends Message> = {
  readonly [K in Exclude<keyof M, 'type'>]-?: (value: unknown) => boolean
}

/** Exact keys and one predicate per field; optional fields are checked only when present. */
function codec<M extends Message>(
  type: M['type'],
  fields: Fields<M>,
  optional: readonly (keyof Fields<M> & string)[] = [],
): MessageType<M> {
  const decode = recordValidator<M>(
    `Invalid ${type} message`,
    { type: (value: unknown) => value === type, ...fields } as Predicates<M>,
    optional,
  )
  return { type, decode }
}

export interface UserDenied {
  type: 'user-denied'
}

export const UserDenied = codec<UserDenied>('user-denied', {})

/** Opaque display text and the failed operation; neither grants authority. */
export interface CeremonyFailed {
  type: 'ceremony-failed'
  event: string
  message: string
}

export const CeremonyFailed = codec<CeremonyFailed>('ceremony-failed', {
  event: isSlug,
  message: (value) => text(value, MAX_MESSAGE_BYTES),
})

/** Application-owned inputs only; raw OAuth returns remain private to Callback and Prover. */
export interface ProveIdentity {
  type: 'prove-identity'
  platformId: string
  platformCeremonyVersion: number
  clientId: string
  redirectUri: string
  codeVerifier: string | null
  notaryAddress: string | null
  clientCredential?: string
}

export const ProveIdentity = codec<ProveIdentity>(
  'prove-identity',
  {
    platformId: isSlug,
    platformCeremonyVersion: (value) => uint(value, MAX_CEREMONY_VERSION),
    clientId: (value) => text(value, MAX_CLIENT_ID_BYTES),
    redirectUri: redirect,
    codeVerifier: (value) => value === null || isPkceValue(value),
    notaryAddress: (value) => value === null || origin(value),
    clientCredential: isClientCredential,
  },
  ['clientCredential'],
)

/** One event envelope for coordination and observations; it never declares ceremony success. */
export type EventMessage = { type: 'event' } & OperationEvent

export const EventMessage: MessageType<EventMessage> = {
  type: 'event',
  decode(value: unknown): EventMessage {
    if (!isRecord(value) || value.type !== 'event') throw new TypeError('Invalid event message')
    const { type: _type, ...event } = value
    validateEvent(event)
    return value as unknown as EventMessage
  },
}

/** Final pipeline output, including all required attestations; the ledger verifier remains authoritative. */
export interface IdentityProof {
  type: 'identity-proof'
  identity: { platformId: string; oauthClientId: string; userId: string; userName: string }
  proof: unknown
}

export const IdentityProof = codec<IdentityProof>('identity-proof', {
  identity: isIdentityShape,
  proof: () => true,
})
