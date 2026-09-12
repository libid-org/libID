import { expect, it, vi } from 'vitest'
import {
  type CeremonyEvent,
  Events,
  type OperationEvent,
  operation,
  type StageEvent,
} from './events.js'

it('projects monotonic presentation while preserving overlapping occurrence timestamps [LIBID-BROWSER-006]', () => {
  const feed = new Events(),
    events: CeremonyEvent[] = [],
    stages: StageEvent[] = []
  feed.onEvent((e) => events.push(e))
  feed.onStage((e) => stages.push(e))
  const emit = (event: string, phase: 'started' | 'finished', timestamp: number) =>
    feed.emit({ event, phase, timestamp, status: 'active' })
  emit('prefetch-dispatch', 'started', 1)
  emit('authorization', 'started', 2)
  emit('authorization', 'finished', 3)
  emit('zk-proof-preparation', 'started', 4)
  emit('token-fetch', 'started', 5)
  emit('zk-proof-generation', 'started', 6)
  emit('token-attestation', 'started', 5.5)
  emit('zk-proof-preparation', 'finished', 7)
  emit('zk-proof-generation', 'finished', 8)
  expect(stages.map((e) => e.stage)).toEqual([
    'preparation',
    'authorization',
    'proof-preparation',
    'notarization',
    'zk-proving',
  ])
  expect(events.at(-4)?.timestamp).toBe(6)
  expect(events.at(-1)?.status).toBe('active')
  feed.emit({
    status: 'failed',
    event: 'identity-attestation',
    message: 'Notary disconnected',
    timestamp: 9,
  })
  expect(stages.at(-1)).toEqual({
    stage: 'zk-proving',
    status: 'failed',
    message: 'Notary disconnected',
    timestamp: 9,
  })
  feed.emit({ event: 'prover', phase: 'finished', status: 'completed', timestamp: 10 })
  expect(events.at(-1)?.status).toBe('failed')
})

it('isolates throwing observers and mutations, and unsubscribes locally', () => {
  const feed = new Events(),
    listen = vi.fn(),
    stage = vi.fn()
  feed.onEvent(() => {
    throw new Error('observer')
  })
  feed.onEvent((e) => {
    if ('attributes' in e && e.attributes) Reflect.set(e.attributes, 'bytes', 99)
  })
  const off = feed.onEvent(listen)
  feed.onStage(stage)
  feed.emit({
    event: 'prefetch-dispatch',
    phase: 'started',
    timestamp: 1,
    status: 'active',
    attributes: { bytes: 1 },
  })
  expect(listen.mock.calls[0][0].attributes.bytes).toBe(1)
  expect(stage).toHaveBeenCalledOnce()
  off()
  feed.emit({ status: 'cancelled', timestamp: 2 })
  expect(listen).toHaveBeenCalledOnce()
  expect(stage).toHaveBeenCalledTimes(2)
})

it('pairs concurrent repeated operations by identifier and leaves interrupted spans unfinished', async () => {
  const events: OperationEvent[] = []
  let finish!: () => void
  const work = operation(
    (e) => events.push(e),
    'session',
    () =>
      new Promise<void>((r) => {
        finish = r
      }),
    'first',
  )
  await expect(
    operation(
      (e) => events.push(e),
      'session',
      () => {
        throw new Error('TLS failed')
      },
      'second',
    ),
  ).rejects.toMatchObject({ event: 'session', message: 'TLS failed' })
  finish()
  await work
  expect(events.map((e) => [e.operationId, e.phase])).toEqual([
    ['first', 'started'],
    ['second', 'started'],
    ['first', 'finished'],
  ])
})
