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

it('coalesces queued marks into one write and skips put/delete when drain overtakes them', async () => {
  const stored = new Map<string, Response>()
  const put = vi.fn(async (key: string, response: Response) => void stored.set(key, response))
  const del = vi.fn(async (key: string) => stored.delete(key))
  const open = vi.fn(async () => ({
    match: async (key: string) => stored.get(key)?.clone(),
    put,
    delete: del,
  }))
  vi.stubGlobal('caches', { open })

  const journal = new Journal('https://ccdp.example')
  // Draining before the queued flush runs returns buffered marks without writing or deleting.
  void journal.record(mark(1, 'started'))
  void journal.record(mark(2, 'finished'))
  expect(await journal.drain()).toEqual([mark(1, 'started'), mark(2, 'finished')])
  expect(put).not.toHaveBeenCalled()
  expect(del).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)

  // Marks recorded after drain() still flush in order into a single put.
  void journal.record(mark(3))
  const drained = journal.drain()
  const persisted = journal.record(mark(4))
  expect(await drained).toEqual([mark(3)])
  await persisted
  expect(put).toHaveBeenCalledTimes(1)
  expect(await new Journal('https://ccdp.example').drain()).toEqual([mark(4)])
})

it('recovers after a transient caches.open failure', async () => {
  const stored = new Map<string, Response>()
  let fail = true
  const open = vi.fn(async () => {
    if (fail) throw new Error('storage unavailable')
    return {
      match: async (key: string) => stored.get(key)?.clone(),
      put: async (key: string, response: Response) => void stored.set(key, response),
      delete: async (key: string) => stored.delete(key),
    }
  })
  vi.stubGlobal('caches', { open })
  const journal = new Journal('https://ccdp.example')
  await expect(journal.record(mark(1))).resolves.toBeUndefined()
  await expect(journal.drain()).resolves.toEqual([])
  fail = false
  await journal.record(mark(2))
  expect(await journal.drain()).toEqual([mark(2)])
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
