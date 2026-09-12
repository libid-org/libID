import type { MessageType } from '@libid/popup'
import { eventName, type OperationEvent, validateEvent } from '../events.js'
import { b64urlDecode, hasExactKeys, isRecord, origin, text, uint, webUrl } from '../primitives.js'

/** Pure CCDP codecs: shape and bounds validation only; transport authentication belongs to popup. */
export const CCDP_VERSION = 1

export const MAX_REDIRECT_URI_BYTES = 2048

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const PLATFORM = /^[a-z][a-z0-9-]{0,63}$/

export function redirect(value: unknown): value is string {
  return text(value, MAX_REDIRECT_URI_BYTES) && webUrl(value) && !/[?#]/.test(value)
}

export function assertMessage<T extends string>(
  value: unknown,
  type: T,
  fields: readonly string[],
): asserts value is Record<string, unknown> & { type: T } {
  if (!isRecord(value) || !hasExactKeys(value, ['type', ...fields]) || value.type !== type)
    throw new TypeError('Invalid CCDP record')
}

export interface Cancel {
  type: 'cancel'
}

export const Cancel = {
  type: 'cancel',
  decode(value: unknown): Cancel {
    assertMessage(value, this.type, [])
    return value
  },
} as const satisfies MessageType<Cancel>

/** Opaque display text and the failed operation; neither grants authority. */
export interface Abort {
  type: 'abort'
  event: string
  message: string
}

export const Abort = {
  type: 'abort',
  decode(value: unknown): Abort {
    assertMessage(value, this.type, ['event', 'message'])
    if (!eventName(value.event) || !text(value.message, 2048))
      throw new TypeError('Invalid abort message')
    return value as unknown as Abort
  },
} as const satisfies MessageType<Abort>

/** Application-owned inputs only; raw OAuth returns remain private to Callback and Prover. */
export interface ProveIdentity {
  type: 'prove-identity'
  platformId: string
  platformCeremonyVersion: number
  clientId: string
  redirectUri: string
  codeVerifier: string | null
  notaryAddress: string | null
}

export const ProveIdentity = {
  type: 'prove-identity',
  decode(value: unknown): ProveIdentity {
    assertMessage(value, this.type, [
      'platformId',
      'platformCeremonyVersion',
      'clientId',
      'redirectUri',
      'codeVerifier',
      'notaryAddress',
    ])
    if (
      typeof value.platformId !== 'string' ||
      !PLATFORM.test(value.platformId) ||
      !uint(value.platformCeremonyVersion, 65535) ||
      !text(value.clientId, 512) ||
      !redirect(value.redirectUri) ||
      !(value.platformId === 'google'
        ? value.notaryAddress === null
        : origin(value.notaryAddress)) ||
      !(
        value.codeVerifier === null ||
        (typeof value.codeVerifier === 'string' &&
          value.codeVerifier.length === 43 &&
          b64urlDecode(value.codeVerifier)?.length === 32)
      )
    )
      throw new TypeError('Invalid proving request')
    return value as unknown as ProveIdentity
  },
} as const satisfies MessageType<ProveIdentity>

/** One event envelope for coordination and observations; it never declares ceremony success. */
export type Event = { type: 'event' } & OperationEvent

export const Event = {
  type: 'event',
  decode(value: unknown): Event {
    if (!isRecord(value) || value.type !== this.type) throw new TypeError('Invalid event')
    validateEvent(value)
    return value as unknown as Event
  },
} as const satisfies MessageType<Event>

/** Final pipeline output, including all required attestations; the ledger verifier remains authoritative. */
export interface IdentityProof {
  type: 'identity-proof'
  identity: { platformId: string; oauthClientId: string; userId: string; userName: string }
  proof: unknown
}

export const IdentityProof = {
  type: 'identity-proof',
  decode(value: unknown): IdentityProof {
    assertMessage(value, this.type, ['identity', 'proof'])
    const identity = value.identity
    if (
      !isRecord(identity) ||
      !hasExactKeys(identity, ['platformId', 'oauthClientId', 'userId', 'userName']) ||
      typeof identity.platformId !== 'string' ||
      !PLATFORM.test(identity.platformId) ||
      !text(identity.oauthClientId, 512) ||
      !text(identity.userId, 255) ||
      !text(identity.userName, 255)
    )
      throw new TypeError('Invalid identity')
    return value as unknown as IdentityProof
  },
} as const satisfies MessageType<IdentityProof>

export type CCDPMessage = ProveIdentity | IdentityProof | Cancel | Abort | Event
