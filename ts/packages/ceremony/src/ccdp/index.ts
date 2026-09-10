import type { MessageType } from '@libid/popup'
import { type FailureCode, failureMessages } from '../errors.js'
import { type ProverStage, stages } from '../events.js'
import { b64urlDecode, hasExactKeys, isRecord } from '../primitives.js'

export const CCDP_VERSION = 1
export const MAX_REDIRECT_URI_BYTES = 2048
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const PLATFORM = /^[a-z][a-z0-9-]{0,63}$/
export function uint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}
export function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    new TextEncoder().encode(value).length <= max
  )
}
export function webUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) &&
      !u.username &&
      !u.password &&
      u.href === value
    )
  } catch {
    return false
  }
}
export function origin(value: unknown): value is string {
  return typeof value === 'string' && webUrl(`${value}/`) && new URL(value).origin === value
}
export function redirect(value: unknown): value is string {
  return (
    text(value, MAX_REDIRECT_URI_BYTES) &&
    webUrl(value) &&
    !new URL(value).search &&
    !new URL(value).hash
  )
}
export function assertMessage<T extends string>(
  value: unknown,
  type: T,
  fields: readonly string[],
): asserts value is Record<string, unknown> & { type: T } {
  if (!isRecord(value) || !hasExactKeys(value, ['type', ...fields]) || value.type !== type)
    throw new TypeError('Invalid CCDP record')
}
export interface PrefetchStarted {
  type: 'prefetch-started'
}
export const PrefetchStarted = {
  type: 'prefetch-started',
  decode(value: unknown): PrefetchStarted {
    assertMessage(value, this.type, [])
    return value
  },
} as const satisfies MessageType<PrefetchStarted>
export interface ProverReady {
  type: 'prover-ready'
}
export const ProverReady = {
  type: 'prover-ready',
  decode(value: unknown): ProverReady {
    assertMessage(value, this.type, [])
    return value
  },
} as const satisfies MessageType<ProverReady>
export interface CancelCeremony {
  type: 'cancel-ceremony'
}
export const CancelCeremony = {
  type: 'cancel-ceremony',
  decode(value: unknown): CancelCeremony {
    assertMessage(value, this.type, [])
    return value
  },
} as const satisfies MessageType<CancelCeremony>
export interface AbortCeremony {
  type: 'abort-ceremony'
  code: FailureCode
  reason: string
}
export const AbortCeremony = {
  type: 'abort-ceremony',
  decode(value: unknown): AbortCeremony {
    assertMessage(value, this.type, ['code', 'reason'])
    if (
      typeof value.code !== 'string' ||
      !Object.hasOwn(failureMessages, value.code) ||
      value.reason !== failureMessages[value.code as FailureCode]
    )
      throw new TypeError('Invalid abort reason')
    return value as unknown as AbortCeremony
  },
} as const satisfies MessageType<AbortCeremony>
export interface AppStartProver {
  type: 'app-start-prover'
  platformId: string
  platformCeremonyVersion: number
  clientId: string
  redirectUri: string
  codeVerifier: string | null
  notaryAddress: string | null
}
export const AppStartProver = {
  type: 'app-start-prover',
  decode(value: unknown): AppStartProver {
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
    return value as unknown as AppStartProver
  },
} as const satisfies MessageType<AppStartProver>
export interface PlatformStep {
  code: string
  label: string
  status: 'started' | 'completed' | 'failed'
  progress: number
}
export type ProverNotifyEvent = {
  type: 'prover-notify-event'
  timestamp: number
} & ({ platformStep: PlatformStep } | { stage: ProverStage })
export const ProverNotifyEvent = {
  type: 'prover-notify-event',
  decode(value: unknown): ProverNotifyEvent {
    if (isRecord(value) && 'stage' in value) {
      assertMessage(value, this.type, ['stage', 'timestamp'])
      if (
        typeof value.stage !== 'string' ||
        !stages.slice(1).some((stage) => stage === value.stage) ||
        typeof value.timestamp !== 'number' ||
        !Number.isFinite(value.timestamp) ||
        value.timestamp < 0
      )
        throw new TypeError('Invalid stage')
      return value as ProverNotifyEvent
    }
    assertMessage(value, this.type, ['platformStep', 'timestamp'])
    const s = value.platformStep
    if (
      !isRecord(s) ||
      !hasExactKeys(s, ['code', 'label', 'status', 'progress']) ||
      !text(s.code, 64) ||
      !/^[a-z][a-z0-9-]*$/.test(s.code) ||
      !text(s.label, 96) ||
      (s.status !== 'started' && s.status !== 'completed' && s.status !== 'failed') ||
      typeof s.progress !== 'number' ||
      !Number.isFinite(s.progress) ||
      s.progress < 0 ||
      s.progress >= 1 ||
      typeof value.timestamp !== 'number' ||
      !Number.isFinite(value.timestamp) ||
      value.timestamp < 0
    )
      throw new TypeError('Invalid progress')
    return value as unknown as ProverNotifyEvent
  },
} as const satisfies MessageType<ProverNotifyEvent>
export interface ProverIdentityProof {
  type: 'prover-identity-proof'
  identity: { platformId: string; oauthClientId: string; userId: string; userName: string }
  proof: unknown
}
export const ProverIdentityProof = {
  type: 'prover-identity-proof',
  decode(value: unknown): ProverIdentityProof {
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
    return value as unknown as ProverIdentityProof
  },
} as const satisfies MessageType<ProverIdentityProof>
export type CCDPMessage =
  | PrefetchStarted
  | ProverReady
  | CancelCeremony
  | AbortCeremony
  | AppStartProver
  | ProverNotifyEvent
  | ProverIdentityProof
