// Dedicated-worker doubles for both ends of postMessage. Unlike the rest of src/testing this module
// depends on Vitest, so tests import it directly rather than through the index.
import { type Mock, vi } from 'vitest'

type Listener = (event: { data: unknown }) => void

/** Whether a recorded postMessage has sent a message of `type`. */
export const posted = (postMessage: Mock, type: string): boolean =>
  postMessage.mock.calls.some(([message]) => message?.type === type)

/** Stub the global scope a worker module registers on; `deliver` runs its message listener. */
export function stubWorkerScope(fields: Record<string, unknown> = {}): {
  postMessage: Mock
  close: Mock
  deliver(data: unknown): void
} {
  let listener: Listener | undefined
  const scope = {
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: (type: string, handler: Listener) => {
      if (type === 'message') listener = handler
    },
    ...fields,
  }
  vi.stubGlobal('self', scope)
  return {
    postMessage: scope.postMessage,
    close: scope.close,
    deliver(data: unknown) {
      if (!listener) throw new Error('The worker registered no message listener')
      listener({ data })
    },
  }
}

/** A parent's view of one worker: tests observe what it is sent and drive what it reports. */
export class FakeWorker extends EventTarget {
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly postMessage: Mock = vi.fn()
  readonly terminate: Mock = vi.fn()

  /** Deliver a message from the worker. */
  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  /** Report an uncaught worker error to both `onerror` and `error` listeners. */
  crash(fields: Partial<Pick<ErrorEvent, 'message' | 'filename' | 'lineno'>>): void {
    const event = Object.assign(new Event('error'), fields) as ErrorEvent
    this.onerror?.(event)
    this.dispatchEvent(event)
  }
}

/** Replace the global Worker; the returned array collects every construction in order. */
export function stubWorkers(): FakeWorker[] {
  const workers: FakeWorker[] = []
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor() {
        super()
        workers.push(this)
      }
    },
  )
  return workers
}
