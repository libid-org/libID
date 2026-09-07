import type { MessageType } from '@libid/popup'
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
export function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && u.href === value
  } catch {
    return false
  }
}
export function origin(value: unknown): value is string {
  return typeof value === 'string' && httpsUrl(`${value}/`) && new URL(value).origin === value
}
export function redirect(value: unknown): value is string {
  return (
    text(value, MAX_REDIRECT_URI_BYTES) &&
    httpsUrl(value) &&
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
  reason: string
}
export const AbortCeremony = {
  type: 'abort-ceremony',
  decode(value: unknown): AbortCeremony {
    assertMessage(value, this.type, ['reason'])
    if (!text(value.reason, 256)) throw new TypeError('Invalid abort reason')
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
    ])
    if (
      typeof value.platformId !== 'string' ||
      !PLATFORM.test(value.platformId) ||
      !uint(value.platformCeremonyVersion, 65535) ||
      !text(value.clientId, 512) ||
      !redirect(value.redirectUri) ||
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
export interface ProverNotifyEvent {
  type: 'prover-notify-event'
  platformStep: PlatformStep
  timestamp: number
}
export const ProverNotifyEvent = {
  type: 'prover-notify-event',
  decode(value: unknown): ProverNotifyEvent {
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
export interface ProverDeliverProof {
  type: 'prover-deliver-proof'
  proof: unknown
}
export const ProverDeliverProof = {
  type: 'prover-deliver-proof',
  decode(value: unknown): ProverDeliverProof {
    assertMessage(value, this.type, ['proof'])
    return value as unknown as ProverDeliverProof
  },
} as const satisfies MessageType<ProverDeliverProof>
export type CCDPMessage =
  | PrefetchStarted
  | ProverReady
  | CancelCeremony
  | AbortCeremony
  | AppStartProver
  | ProverNotifyEvent
  | ProverDeliverProof
