import { type CeremonyError, toCeremonyError } from './errors.js'

/** Core operations have protocol-owned meanings; extension events grant no protocol authority. */
const coreEvents = [
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
  /** Optional tracing metadata; never credentials, identity values, or raw errors. */
  instrumentation?: {
    operationId?: string
    attributes?: Readonly<Record<string, string | number | boolean>>
  }
}

export type CeremonyStatus = 'active' | 'completed' | 'denied' | 'failed' | 'closed'

export type CeremonyEvent =
  | (OperationEvent & { status: 'active' })
  | { event: 'prover'; phase: 'finished'; timestamp: number; status: 'completed' }
  | { status: 'denied'; timestamp: number }
  | { status: 'failed' | 'closed'; event: string; message: string; timestamp: number }

export const now = () => performance.timeOrigin + performance.now()

export const isCoreEvent = (event: string): event is CoreEvent =>
  coreEvents.includes(event as CoreEvent)

const stages = [
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

/** The stage each operation occurrence projects, keyed by `event/phase`. */
const projections = new Map<string, CeremonyStage>([
  ['prefetch-dispatch/started', 'preparation'],
  ['authorization/started', 'authorization'],
  ['authorization/finished', 'proof-preparation'],
  ['prover/started', 'proof-preparation'],
  ['token-fetch/started', 'notarization'],
  ['token-attestation/started', 'notarization'],
  ['zk-proof-generation/started', 'zk-proving'],
])

const projectedStage = (event: CeremonyEvent): CeremonyStage | undefined =>
  'phase' in event ? projections.get(`${event.event}/${event.phase}`) : undefined

/** A local feed shared by the client and popup documents; observers never control its producer. */
export class EventFeed {
  private readonly listeners = new Set<(event: CeremonyEvent) => void>()
  private readonly stageListeners = new Set<(event: StageEvent) => void>()
  private stage: CeremonyStage | undefined
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
    const changed = this.advance(projectedStage(event))
    const stageUpdate = Object.freeze({
      stage: this.stage ?? 'preparation',
      status: event.status,
      timestamp: event.timestamp,
      ...('message' in event ? { message: event.message } : {}),
    })
    this.notify(this.listeners, snapshot(event), terminal)
    if (changed || terminal) this.notify(this.stageListeners, stageUpdate, terminal)
    if (terminal) this.clear()
  }

  /** Stages only move forward; the first projection may start at any stage. */
  private advance(stage: CeremonyStage | undefined): boolean {
    if (
      stage === undefined ||
      (this.stage !== undefined && stages.indexOf(stage) <= stages.indexOf(this.stage))
    )
      return false
    this.stage = stage
    return true
  }

  private clear(): void {
    this.listeners.clear()
    this.stageListeners.clear()
  }

  /** A listener's terminal emission stops delivery of the active update that preceded it. */
  private notify<T>(listeners: Set<(update: T) => void>, update: T, terminal: boolean): void {
    for (const listener of [...listeners]) {
      if (this.ended && !terminal) break
      try {
        listener(update)
      } catch {
        /* Observers and rendering cannot affect protocol processing. */
      }
    }
  }
}

/** Observers share one immutable update, including its instrumentation. */
function snapshot(event: CeremonyEvent): CeremonyEvent {
  if (!('instrumentation' in event) || !event.instrumentation) return Object.freeze({ ...event })
  const { attributes } = event.instrumentation
  return Object.freeze({
    ...event,
    instrumentation: Object.freeze({
      ...event.instrumentation,
      ...(attributes ? { attributes: Object.freeze({ ...attributes }) } : {}),
    }),
  })
}

/** The terminal update for a failure, carrying its status, operation and display text. */
export function failureEvent(
  failure: CeremonyError,
): Extract<CeremonyEvent, { status: 'failed' | 'closed' }> {
  return {
    status: failure.status,
    event: failure.event,
    message: failure.message,
    timestamp: now(),
  }
}

/** Observers cannot change the outcome of the work they watch. */
export function safeEmit(emit: (event: OperationEvent) => void): (event: OperationEvent) => void {
  return (event) => {
    try {
      emit(event)
    } catch {
      /* Ignored. */
    }
  }
}

/** Interruptions preserve the original error and never fabricate a finished operation. */
export async function operation<T>(
  emit: (event: OperationEvent) => void,
  event: string,
  work: () => T | Promise<T>,
  operationId?: string,
): Promise<T> {
  const context = {
    event,
    ...(operationId === undefined ? {} : { instrumentation: { operationId } }),
  }
  emit({ ...context, phase: 'started', timestamp: now() })
  try {
    const result = await work()
    emit({ ...context, phase: 'finished', timestamp: now() })
    return result
  } catch (error) {
    throw toCeremonyError(error, event)
  }
}
