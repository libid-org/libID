import type { PlatformStep } from '../ccdp/index.js'

export interface ProgressSpan {
  code: string
  label: string
  weight: number
  parent?: string
}

type Status = PlatformStep['status']

/** A small, closed span tracker shared by every proof engine. */
export class Progress {
  readonly #spans: ReadonlyMap<string, ProgressSpan>
  readonly #emit: (step: PlatformStep) => void
  readonly #status = new Map<string, Status>()
  readonly #totalWeight: number
  #completedWeight = 0
  #target = 0

  constructor(catalog: readonly ProgressSpan[], emit: (step: PlatformStep) => void) {
    const spans = new Map<string, ProgressSpan>()
    for (const span of catalog) {
      if (
        !/^[a-z][a-z0-9-]{0,63}$/.test(span.code) ||
        span.label.length === 0 ||
        new TextEncoder().encode(span.label).length > 96 ||
        /\p{Cc}/u.test(span.label) ||
        !Number.isFinite(span.weight) ||
        span.weight < 0 ||
        spans.has(span.code)
      ) {
        throw new Error('invalid progress span catalog')
      }
      spans.set(span.code, Object.freeze({ ...span }))
    }
    for (const span of spans.values()) {
      if (!span.parent) continue
      const parent = spans.get(span.parent)
      if (parent?.weight !== 0 || parent.code === span.code) {
        throw new Error('invalid progress span parent')
      }
      const seen = new Set([span.code])
      let cursor: ProgressSpan | undefined = parent
      while (cursor) {
        if (seen.has(cursor.code)) throw new Error('progress span cycle')
        seen.add(cursor.code)
        cursor = cursor.parent ? spans.get(cursor.parent) : undefined
      }
    }
    this.#totalWeight = [...spans.values()].reduce((sum, span) => sum + span.weight, 0)
    if (this.#totalWeight <= 0) throw new Error('progress catalog needs a weighted leaf')
    this.#spans = spans
    this.#emit = emit
  }

  start(code: string): void {
    const span = this.#span(code)
    if (this.#status.has(code)) throw new Error(`progress span already started: ${code}`)
    if (span.parent && this.#status.get(span.parent) !== 'started') {
      throw new Error(`progress parent is not active: ${span.parent}`)
    }
    this.#status.set(code, 'started')
    this.#publish(span, 'started')
  }

  complete(code: string): void {
    this.#finish(code, 'completed')
  }

  fail(code: string): void {
    this.#finish(code, 'failed')
  }

  async step<T>(code: string, work: () => T | Promise<T>): Promise<T> {
    this.start(code)
    try {
      const value = await work()
      this.complete(code)
      return value
    } catch (error) {
      this.fail(code)
      throw error
    }
  }

  failActive(): void {
    const active = [...this.#status]
      .filter(([, status]) => status === 'started')
      .map(([code]) => this.#span(code))
      .sort((a, b) => this.#depth(b) - this.#depth(a))
    for (const span of active) this.fail(span.code)
  }

  #finish(code: string, status: Exclude<Status, 'started'>): void {
    const span = this.#span(code)
    if (this.#status.get(code) !== 'started') {
      throw new Error(`progress span is not active: ${code}`)
    }
    for (const child of this.#spans.values()) {
      if (child.parent === code && this.#status.get(child.code) === 'started') {
        throw new Error(`progress child is still active: ${child.code}`)
      }
    }
    this.#status.set(code, status)
    if (status === 'completed') {
      this.#completedWeight += span.weight
      this.#target = Math.max(this.#target, (0.95 * this.#completedWeight) / this.#totalWeight)
    }
    this.#publish(span, status)
  }

  #span(code: string): ProgressSpan {
    const span = this.#spans.get(code)
    if (!span) throw new Error(`unknown progress span: ${code}`)
    return span
  }

  #publish(span: ProgressSpan, status: Status): void {
    this.#emit({ code: span.code, label: span.label, status, progress: this.#target })
  }

  #depth(span: ProgressSpan): number {
    let depth = 0
    let cursor = span
    while (cursor.parent) {
      depth++
      cursor = this.#span(cursor.parent)
    }
    return depth
  }
}
