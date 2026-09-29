import { messages } from './ccdp/ui-messages.js'
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
      (key) => !['event', 'phase', 'timestamp', 'instrumentation', 'type'].includes(key),
    ) ||
    ('phase' in value && value.phase !== 'started' && value.phase !== 'finished')
  )
    throw new TypeError('Invalid operation event')
  const core = coreEvents.includes(value.event as CoreEvent)
  if (core && (value.event === 'prover-fallback' ? 'phase' in value : !('phase' in value)))
    throw new TypeError('Invalid core event phase')
  if ('instrumentation' in value) validateInstrumentation(value.instrumentation, core)
}

/** Core events carry no operation ID; attributes are a few scalar measurements. */
function validateInstrumentation(metadata: unknown, core: boolean): void {
  if (
    !isRecord(metadata) ||
    Object.keys(metadata).some((key) => !['operationId', 'attributes'].includes(key)) ||
    ('operationId' in metadata && (!text(metadata.operationId, 64) || core))
  )
    throw new TypeError('Invalid event instrumentation')
  if (
    'attributes' in metadata &&
    (!isRecord(metadata.attributes) ||
      Object.keys(metadata.attributes).length > 16 ||
      Object.entries(metadata.attributes).some(
        ([key, value]) =>
          !eventName(key) ||
          !(
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value)) ||
            text(value, 128)
          ),
      ))
  )
    throw new TypeError('Invalid event attributes')
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
      preparation: messages.preparation,
      authorization: messages.authorization(platform),
      'proof-preparation': messages.proofPreparation,
      notarization: messages.notarization,
      'zk-proving': messages.zkProving,
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
    const stageUpdate = Object.freeze({
      stage: this.stage,
      status: event.status,
      timestamp: event.timestamp,
      ...('message' in event ? { message: event.message } : {}),
    })
    this.notify(this.listeners, snapshot(event), terminal)
    if (changed || terminal) this.notify(this.stageListeners, stageUpdate, terminal)
    if (terminal) this.clear()
  }

  clear(): void {
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
    throw ceremonyError(error, event)
  }
}
