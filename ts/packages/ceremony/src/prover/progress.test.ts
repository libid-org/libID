import { describe, expect, it, vi } from 'vitest'
import type { PlatformStep } from '../ccdp/index.js'
import { Progress, type ProgressSpan } from './progress.js'

const catalog = [
  { code: 'boot', label: 'Preparing prover', weight: 0 },
  { code: 'wasm', label: 'Loading prover', weight: 2, parent: 'boot' },
  { code: 'circuit', label: 'Loading circuit', weight: 1, parent: 'boot' },
  { code: 'proof', label: 'Generating proof', weight: 7 },
] satisfies readonly ProgressSpan[]

function recorder() {
  const events: PlatformStep[] = []
  return { events, progress: new Progress(catalog, (event) => events.push(event)) }
}

describe('Progress', () => {
  it('weights leaves, keeps zero-weight parents neutral, and remains monotonic', () => {
    const { events, progress } = recorder()
    progress.start('boot')
    progress.start('circuit')
    progress.complete('circuit')
    progress.start('wasm')
    progress.complete('wasm')
    progress.complete('boot')
    progress.start('proof')
    progress.complete('proof')

    expect(events.map(({ code, status }) => `${code}:${status}`)).toEqual([
      'boot:started',
      'circuit:started',
      'circuit:completed',
      'wasm:started',
      'wasm:completed',
      'boot:completed',
      'proof:started',
      'proof:completed',
    ])
    expect(events.map((event) => event.progress)).toEqual([
      0, 0, 0.095, 0.095, 0.285, 0.285, 0.285, 0.95,
    ])
  })

  it('emits the same lifecycle for cached and cold work', async () => {
    const cold = recorder()
    const cached = recorder()
    await cold.progress.step('proof', async () => 'cold')
    await cached.progress.step('proof', () => 'cached')
    expect(cached.events).toEqual(cold.events)
  })

  it('terminates each active span exactly once on failure', () => {
    const { events, progress } = recorder()
    progress.start('boot')
    progress.start('wasm')
    progress.failActive()
    expect(events.map(({ code, status }) => `${code}:${status}`)).toEqual([
      'boot:started',
      'wasm:started',
      'wasm:failed',
      'boot:failed',
    ])
    expect(() => progress.start('circuit')).toThrow('progress parent is not active')
  })

  it('fails a step and preserves its error', async () => {
    const emit = vi.fn()
    const progress = new Progress(catalog, emit)
    await expect(
      progress.step('proof', () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(emit.mock.calls.map((call) => (call[0] as PlatformStep).status)).toEqual([
      'started',
      'failed',
    ])
  })

  it.each([
    [[{ code: 'x', label: 'X', weight: 0 }], 'weighted leaf'],
    [[{ code: 'X', label: 'X', weight: 1 }], 'catalog'],
    [
      [
        { code: 'x', label: 'X', weight: 1, parent: 'y' },
        { code: 'y', label: 'Y', weight: 1 },
      ],
      'parent',
    ],
    [
      [
        { code: 'x', label: 'X', weight: 0, parent: 'y' },
        { code: 'y', label: 'Y', weight: 0, parent: 'x' },
        { code: 'z', label: 'Z', weight: 1 },
      ],
      'cycle',
    ],
  ] as const)('rejects an invalid catalog %#', (bad, message) => {
    expect(() => new Progress(bad, () => undefined)).toThrow(message)
  })
})
