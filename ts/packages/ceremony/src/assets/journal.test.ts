import { afterEach, expect, it, vi } from 'vitest'
import { isMark, JOURNAL_LIMIT, Journal, type Mark } from './journal.js'

afterEach(() => vi.unstubAllGlobals())

/** A Cache Storage double holding responses by key; returns the backing map. */
function storage() {
  const stored = new Map<string, Response>()
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (key: string) => stored.get(key)?.clone(),
      put: async (key: string, response: Response) => void stored.set(key, response),
      delete: async (key: string) => stored.delete(key),
    }),
  })
  return stored
}

const mark = (n: number, phase?: Mark['phase']): Mark => ({
  event: 'root-worker-start',
  ...(phase && { phase }),
  timestamp: n,
  operationId: `op-${n}`,
})

it('keeps marks in order across instances until drained, then starts empty', async () => {
  storage()
  const writer = new Journal('https://ccdp.example')
  void writer.record(mark(1, 'started'))
  await writer.record(mark(2))
  // A restarted Worker reads what its predecessor kept.
  const reader = new Journal('https://ccdp.example')
  expect(await reader.drain()).toEqual([mark(1, 'started'), mark(2)])
  expect(await reader.drain()).toEqual([])
})

it('keeps only the newest marks', async () => {
  storage()
  const journal = new Journal('https://ccdp.example')
  for (let n = 0; n < JOURNAL_LIMIT + 3; n++) void journal.record(mark(n))
  const kept = await journal.drain()
  expect(kept).toHaveLength(JOURNAL_LIMIT)
  expect(kept[0]).toEqual(mark(3))
})

it('drops malformed stored entries and unreadable bodies', async () => {
  const stored = storage()
  const key = 'https://ccdp.example/ccdp/journal'
  stored.set(key, Response.json([mark(1), { event: 'Bad Event', timestamp: 2, operationId: 'x' }]))
  const journal = new Journal('https://ccdp.example')
  expect(await journal.drain()).toEqual([mark(1)])
  stored.set(key, new Response('not json'))
  expect(await journal.drain()).toEqual([])
})

it('drops marks and reads none when storage fails, never rejecting', async () => {
  vi.stubGlobal('caches', { open: async () => Promise.reject(new Error('storage unavailable')) })
  const journal = new Journal('https://ccdp.example')
  await expect(journal.record(mark(1))).resolves.toBeUndefined()
  await expect(journal.drain()).resolves.toEqual([])
})

it.each([
  [{ ...mark(1), phase: 'paused' }],
  [{ ...mark(1), timestamp: -1 }],
  [{ ...mark(1), timestamp: Number.NaN }],
  [{ ...mark(1), operationId: 'x'.repeat(65) }],
  [{ ...mark(1), extra: true }],
])('rejects %o as a mark', (value) => {
  expect(isMark(value)).toBe(false)
})
