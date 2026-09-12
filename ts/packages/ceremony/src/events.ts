import { ceremonyError } from './errors.js'
import { isRecord, text } from './primitives.js'

/** Core operations have protocol-owned meanings; extension events grant no protocol authority. */
export const coreEvents = [
  'prefetch-dispatch',
  'authorization',
  'prover',
  'prover-fallback',
  'token-fetch',
  'token-attestation',
  'identity-fetch',
  'identity-attestation',
  'zk-proof-preparation',
  'zk-proof-generation',
] as const

export type CoreEvent = (typeof coreEvents)[number]

/** Timestamps record occurrence in the producing document or worker, in epoch milliseconds. */
export interface OperationEvent {
  event: string
  phase?: 'started' | 'finished'
  timestamp: number
  /** Instrumentation only; required to distinguish overlapping instances of the same operation. */
  operationId?: string
  /** Producer-owned bounded measurements and coarse facts; never credentials or raw errors. */
  attributes?: Readonly<Record<string, string | number | boolean>>
}

export type CeremonyStatus = 'active' | 'completed' | 'denied' | 'cancelled' | 'failed'

export type CeremonyEvent =
  | (OperationEvent & { status: 'active' })
  | { event: 'prover'; phase: 'finished'; timestamp: number; status: 'completed' }
  | { status: 'denied' | 'cancelled'; timestamp: number }
  | { status: 'failed'; event: string; message: string; timestamp: number }

export const now = () => performance.timeOrigin + performance.now()

export function eventName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
}

/** Exact bounded records are validated at the transport boundary, independently of subscriptions. */
export function validateEvent(value: unknown): asserts value is OperationEvent {
  if (
    !isRecord(value) ||
    !eventName(value.event) ||
    typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp < 0 ||
    Object.keys(value).some(
      (key) => !['event', 'phase', 'timestamp', 'operationId', 'attributes', 'type'].includes(key),
    ) ||
    ('phase' in value && value.phase !== 'started' && value.phase !== 'finished') ||
    ('operationId' in value && !text(value.operationId, 64))
  )
    throw new TypeError('Invalid operation event')
  if (coreEvents.includes(value.event as CoreEvent)) {
    if (value.event === 'prover-fallback' ? 'phase' in value : !('phase' in value))
      throw new TypeError('Invalid core event phase')
    if ('operationId' in value) throw new TypeError('Core operations occur once')
  }
  if ('attributes' in value) {
    if (
      !isRecord(value.attributes) ||
      Object.keys(value.attributes).length > 16 ||
      Object.entries(value.attributes).some(
        ([key, v]) =>
          !eventName(key) ||
          !(
            typeof v === 'boolean' ||
            (typeof v === 'number' && Number.isFinite(v)) ||
            text(v, 128)
          ),
      )
    )
      throw new TypeError('Invalid event attributes')
  }
}

export const stages = [
  'preparation',
  'authorization',
  'proof-preparation',
  'notarization',
  'zk-proving',
] as const

export type CeremonyStage = (typeof stages)[number]

export interface StageEvent {
  stage: CeremonyStage
  status: CeremonyStatus
  timestamp: number
  message?: string
}

/** Package-owned presentation; stage intervals do not describe exclusive execution time. */
export const CeremonyStage = {
  message(stage: CeremonyStage, platform: string): string {
    return {
      preparation: 'Preparing your ceremony',
      authorization: `Authorize with ${platform}`,
      'proof-preparation': 'Preparing your identity proof',
      notarization: 'Notarizing your identity data',
      'zk-proving': 'Creating your identity proof with ZK',
    }[stage]
  },
}

function projectedStage(event: CeremonyEvent): CeremonyStage | undefined {
  if (!('phase' in event)) return
  if (event.event === 'prefetch-dispatch' && event.phase === 'started') return 'preparation'
  if (event.event === 'prover' && event.phase === 'started') return 'proof-preparation'
  if (event.event === 'authorization')
    return event.phase === 'started' ? 'authorization' : 'proof-preparation'
  if (
    (event.event === 'token-fetch' || event.event === 'token-attestation') &&
    event.phase === 'started'
  )
    return 'notarization'
  if (event.event === 'zk-proof-generation' && event.phase === 'started') return 'zk-proving'
}

/** A local feed shared by the client and popup documents; observers never control its producer. */
export class Events {
  private readonly listeners = new Set<(event: CeremonyEvent) => void>()
  private readonly stageListeners = new Set<(event: StageEvent) => void>()
  private stage: CeremonyStage = 'preparation'
  private stageSeen = false
  private ended = false

  onEvent(listener: (event: CeremonyEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStage(listener: (event: StageEvent) => void): () => void {
    this.stageListeners.add(listener)
    return () => this.stageListeners.delete(listener)
  }

  emit(event: CeremonyEvent): void {
    if (this.ended) return
    const terminal = event.status !== 'active'
    if (terminal) this.ended = true
    const projected = projectedStage(event)
    const changed =
      projected !== undefined &&
      (!this.stageSeen || stages.indexOf(projected) > stages.indexOf(this.stage))
    if (changed) {
      this.stage = projected
      this.stageSeen = true
    }
    const update = Object.freeze({
      ...event,
      ...('attributes' in event && event.attributes
        ? { attributes: Object.freeze({ ...event.attributes }) }
        : {}),
    })
    const stageUpdate = Object.freeze({
      stage: this.stage,
      status: event.status,
      timestamp: event.timestamp,
      ...('message' in event ? { message: event.message } : {}),
    })
    for (const listener of [...this.listeners]) {
      if (this.ended && !terminal) break
      try {
        listener(update)
      } catch {
        /* Observers cannot affect protocol processing. */
      }
    }
    if (changed || terminal)
      for (const listener of [...this.stageListeners]) {
        if (this.ended && !terminal) break
        try {
          listener(stageUpdate)
        } catch {
          /* Rendering cannot affect protocol processing. */
        }
      }
    if (terminal) this.clear()
  }

  clear(): void {
    this.listeners.clear()
    this.stageListeners.clear()
  }
}

/** Interruptions preserve the original error and never fabricate a finished operation. */
export async function operation<T>(
  emit: (event: OperationEvent) => void,
  event: string,
  work: () => T | Promise<T>,
  operationId?: string,
): Promise<T> {
  const context = { event, ...(operationId === undefined ? {} : { operationId }) }
  emit({ ...context, phase: 'started', timestamp: now() })
  try {
    const result = await work()
    emit({ ...context, phase: 'finished', timestamp: now() })
    return result
  } catch (error) {
    throw ceremonyError(error, event)
  }
}
