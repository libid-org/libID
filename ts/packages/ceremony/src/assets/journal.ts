import { MAX_OPERATION_ID_BYTES } from '../ccdp/limits.js'
import { isCoreEvent } from '../events.js'
import { hasExactKeys, isSlug, isText } from '../primitives.js'

/** One root Worker lifecycle occurrence, forwarded later as an extension operation event. */
export interface Mark {
  event: string
  phase?: 'started' | 'finished'
  timestamp: number
  operationId: string
}

const CACHE = 'ceremony-journal'
/** The newest marks kept between forwards. */
export const JOURNAL_LIMIT = 64

/** Well-formed extension marks only: stored entries can never collide with core protocol events. */
export const isMark = (value: unknown): value is Mark =>
  hasExactKeys(value, ['event', 'timestamp', 'operationId'], ['phase']) &&
  isSlug(value.event) &&
  !isCoreEvent(value.event) &&
  typeof value.timestamp === 'number' &&
  Number.isFinite(value.timestamp) &&
  value.timestamp >= 0 &&
  (!('phase' in value) || value.phase === 'started' || value.phase === 'finished') &&
  isText(value.operationId, MAX_OPERATION_ID_BYTES)

/**
 * The root Worker's own lifecycle marks, kept until a later document forwards them: a document
 * whose load stalls never runs to report, and a browser restart drops the Worker's memory.
 * ponytail: shares Cache Storage with the assets, so a stall inside Cache Storage itself goes
 * unrecorded; move to IndexedDB if that case needs evidence.
 */
export class Journal {
  private queue = Promise.resolve()
  private pending: Mark[] = []
  private flushing = false
  private readonly key: string

  constructor(origin: string) {
    this.key = `${origin}/ccdp/journal`
  }

  /** Appends in order, coalescing marks queued before the write runs; drops on storage failure. */
  record(mark: Mark): Promise<void> {
    this.pending.push(mark)
    if (this.pending.length > JOURNAL_LIMIT)
      this.pending.splice(0, this.pending.length - JOURNAL_LIMIT)
    if (!this.flushing) {
      this.flushing = true
      const batch = this.pending
      this.queue = this.queue
        .then(async () => {
          if (this.pending === batch) {
            this.pending = []
            this.flushing = false
          }
          if (!batch.length) return
          const cache = await caches.open(CACHE)
          const marks = await this.read(cache)
          await cache.put(this.key, Response.json([...marks, ...batch].slice(-JOURNAL_LIMIT)))
        })
        .catch(() => {})
    }
    return this.queue
  }

  /** Every kept mark, oldest first, removing them; returns buffered marks even when storage fails. */
  drain(): Promise<Mark[]> {
    const buffered = this.pending.splice(0)
    this.pending = []
    this.flushing = false
    const drained = this.queue.then(async () => {
      try {
        const cache = await caches.open(CACHE)
        const stored = await cache.match(this.key)
        const marks = stored ? await this.parse(stored) : []
        if (stored) await cache.delete(this.key)
        return [...marks, ...buffered].slice(-JOURNAL_LIMIT)
      } catch {
        return buffered.slice(-JOURNAL_LIMIT)
      }
    })
    this.queue = drained.then(() => {})
    return drained
  }

  private async read(cache: Cache): Promise<Mark[]> {
    const stored = await cache.match(this.key)
    return stored ? this.parse(stored) : []
  }

  private async parse(stored: Response): Promise<Mark[]> {
    const marks: unknown = await stored.json().catch(() => [])
    return Array.isArray(marks) ? marks.filter(isMark) : []
  }
}
