import { MAX_OPERATION_ID_BYTES } from '../ccdp/limits.js'
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

/** Well-formed marks only: a stored entry from another build never reaches the connection. */
export const isMark = (value: unknown): value is Mark =>
  hasExactKeys(value, ['event', 'timestamp', 'operationId'], ['phase']) &&
  isSlug(value.event) &&
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
  private readonly key: string

  constructor(origin: string) {
    this.key = `${origin}/ccdp/journal`
  }

  /** Appends in order, best effort: a mark that cannot be kept is dropped. */
  record(mark: Mark): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const cache = await caches.open(CACHE)
        const marks = await this.read(cache)
        await cache.put(this.key, Response.json([...marks, mark].slice(-JOURNAL_LIMIT)))
      })
      .catch(() => {})
    return this.queue
  }

  /** Every kept mark, oldest first, removing them; none when storage fails. */
  drain(): Promise<Mark[]> {
    const drained = this.queue.then(async () => {
      try {
        const cache = await caches.open(CACHE)
        const marks = await this.read(cache)
        await cache.delete(this.key)
        return marks
      } catch {
        return []
      }
    })
    this.queue = drained.then(() => {})
    return drained
  }

  private async read(cache: Cache): Promise<Mark[]> {
    const stored = await cache.match(this.key)
    const marks: unknown = await stored?.json().catch(() => [])
    return Array.isArray(marks) ? marks.filter(isMark) : []
  }
}
