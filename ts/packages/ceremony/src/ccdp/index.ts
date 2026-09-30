// Pure CCDP codecs: shape and bounds validation only; transport authentication belongs to popup.
import type { Message, MessageType } from '@libid/popup'
import { type OperationEvent, validateEvent } from '../events.js'
import { isPkceValue } from '../platforms/authorization.js'
import {
  hasExactKeys,
  isOrigin,
  isRecord,
  isSlug,
  isText,
  isUint,
  isWebUrl,
  type Predicates,
  recordValidator,
} from '../primitives.js'
import {
  MAX_CEREMONY_VERSION,
  MAX_CLIENT_CREDENTIAL_BYTES,
  MAX_CLIENT_ID_BYTES,
  MAX_FAILURE_TEXT_BYTES,
  MAX_IDENTITY_TEXT_BYTES,
  MAX_REDIRECT_URI_BYTES,
} from './limits.js'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Public OAuth application credential: bounded like clientId, without whitespace or control bytes. */
export const isClientCredential = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_CLIENT_CREDENTIAL_BYTES &&
  /^[\x21-\x7e]+$/.test(value)

export function isRedirectUri(value: unknown): value is string {
  return isText(value, MAX_REDIRECT_URI_BYTES) && isWebUrl(value) && !/[?#]/.test(value)
}

/** Shared identity shape; each platform slice checks its own platform ID and byte limits. */
function isIdentityShape(value: unknown): value is IdentityProof['identity'] {
  return (
    hasExactKeys(value, ['platformId', 'oauthClientId', 'userId', 'userName']) &&
    isSlug(value.platformId) &&
    isText(value.oauthClientId, MAX_CLIENT_ID_BYTES) &&
    isText(value.userId, MAX_IDENTITY_TEXT_BYTES) &&
    isText(value.userName, MAX_IDENTITY_TEXT_BYTES)
  )
}

type Fields<M extends Message> = Readonly<Predicates<Omit<M, 'type'>>>

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
  message: (value) => isText(value, MAX_FAILURE_TEXT_BYTES),
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
    platformCeremonyVersion: (value) => isUint(value, MAX_CEREMONY_VERSION),
    clientId: (value) => isText(value, MAX_CLIENT_ID_BYTES),
    redirectUri: isRedirectUri,
    codeVerifier: (value) => value === null || isPkceValue(value),
    notaryAddress: (value) => value === null || isOrigin(value),
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

/** Final prover output, including all required attestations; the ledger verifier remains authoritative. */
export interface IdentityProof {
  type: 'identity-proof'
  identity: { platformId: string; oauthClientId: string; userId: string; userName: string }
  proof: unknown
}

export const IdentityProof = codec<IdentityProof>('identity-proof', {
  identity: isIdentityShape,
  proof: () => true,
})
