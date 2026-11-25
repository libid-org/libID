import { isMark, type Mark } from './journal.js'

const SERVICE_WORKER_TIMEOUT_MS = 15000
const ACTIVATION_POLL_INTERVAL_MS = 50
/** Forwarding the journal is diagnostic; it never holds the ceremony longer than this. */
const JOURNAL_TIMEOUT_MS = 1000

/**
 * Settle through `done` within `ms` (15 seconds by default), rejecting with `timeout` past it;
 * a null `timeout` sets no deadline. Aborting `abort` rejects with its reason. Settling, including
 * a synchronous throw from `start`, clears the timer and aborts `signal`, removing listeners
 * registered with it.
 */
function within(
  timeout: string | null,
  start: (done: (error?: unknown) => void, signal: AbortSignal) => void,
  { ms = SERVICE_WORKER_TIMEOUT_MS, abort }: { ms?: number; abort?: AbortSignal } = {},
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const settled = new AbortController()
  const timer = timeout === null ? undefined : setTimeout(() => done(new Error(timeout)), ms)
  const done = (error?: unknown) => {
    clearTimeout(timer)
    settled.abort()
    if (error === undefined) resolve()
    else reject(error)
  }
  try {
    abort?.throwIfAborted()
    abort?.addEventListener('abort', () => done(abort.reason), { signal: settled.signal })
    start(done, settled.signal)
  } catch (error) {
    done(error)
  }
  return promise
}

/** Settle with `pending`, or reject at once with `signal.reason` if `signal` aborts first. */
function raceAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) {
    void pending.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** Register the build-pinned root script and return that Worker, never an older active one. */
export async function registerRootWorker(
  url: string,
  signal?: AbortSignal,
): Promise<ServiceWorker> {
  signal?.throwIfAborted()
  const script = new URL(url, location.origin).href
  const registration = await raceAbort(
    navigator.serviceWorker.register(script, {
      scope: '/',
      type: 'module',
      updateViaCache: 'all',
    }),
    signal,
  )
  if (registration.scope !== `${location.origin}/`)
    throw new Error('Incorrect Service Worker scope')
  if (registration.active?.scriptURL === script && registration.active.state !== 'redundant')
    return registration.active
  // WebKit can resolve register() before the registration shows the Worker it installs.
  let pinned: ServiceWorker | null | undefined
  await within(
    'Missing build-pinned Service Worker',
    (done, settled) => {
      const find = () => {
        pinned = [registration.installing, registration.waiting, registration.active].find(
          (worker) => worker?.scriptURL === script,
        )
        if (pinned) done()
      }
      const poll = setInterval(find, ACTIVATION_POLL_INTERVAL_MS)
      settled.addEventListener('abort', () => clearInterval(poll))
      registration.addEventListener('updatefound', find, { signal: settled })
      find()
    },
    { abort: signal },
  )
  const worker = pinned!
  await within(
    'Service Worker installation timed out',
    (done, settled) => {
      const changed = () => {
        if (worker.state === 'redundant') done(new Error('Service Worker failed'))
        else if (worker.state !== 'installing' && worker.state !== 'parsed') done()
      }
      // Concurrent Chromium popups can lose statechange notifications; sample the same state too.
      const poll = setInterval(changed, ACTIVATION_POLL_INTERVAL_MS)
      settled.addEventListener('abort', () => clearInterval(poll))
      worker.addEventListener('statechange', changed, { signal: settled })
      changed()
    },
    { abort: signal },
  )
  return worker
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

/** Send `message` with a reply port, detaching and closing both ends on settle or throw. */
function postPort(
  worker: ServiceWorker,
  message: unknown,
  signal: AbortSignal,
  onMessage: (event: MessageEvent) => void,
): void {
  const { port1, port2 } = new MessageChannel()
  signal.addEventListener('abort', () => {
    port1.onmessage = null
    port1.close()
  })
  port1.onmessage = onMessage
  try {
    worker.postMessage(message, [port2])
  } catch (error) {
    port2.close()
    throw error
  }
}

/**
 * Dispatch directly to the selected Worker, including while it waits behind an older active one.
 * Resolves with how many requests were stored and fetched, when the Worker reports both.
 */
export async function dispatchPrefetch(
  worker: ServiceWorker,
  profile: string,
  signal?: AbortSignal,
): Promise<{ cached: number; fetched: number } | undefined> {
  let counts: { cached: number; fetched: number } | undefined
  await within(
    'Asset dispatch timed out',
    (done, settled) => {
      try {
        postPort(worker, { type: 'ceremony-prefetch', profile }, settled, ({ data }) => {
          const { dispatched, cached, fetched } = data ?? {}
          if (isCount(cached) && isCount(fetched)) counts = { cached, fetched }
          if (dispatched === true) done()
          else if (dispatched === false) done(new Error('Asset profile not served'))
          else done(new Error('Invalid dispatch acknowledgement'))
        })
      } catch {
        done(new Error('Asset dispatch failed'))
      }
    },
    { abort: signal },
  )
  return counts
}

/**
 * The Worker's kept lifecycle marks, removed as they are read. None when the Worker does not
 * answer within a second, as when its Cache Storage stalls.
 */
export async function drainJournal(worker: ServiceWorker, signal?: AbortSignal): Promise<Mark[]> {
  let marks: Mark[] = []
  await within(
    'Journal timed out',
    (done, settled) => {
      postPort(worker, { type: 'ceremony-journal' }, settled, ({ data }) => {
        if (Array.isArray(data?.marks)) marks = data.marks.filter(isMark)
        done()
      })
    },
    { ms: JOURNAL_TIMEOUT_MS, abort: signal },
  ).catch(() => {})
  return marks
}

/**
 * The profile's retrievals still running, once they settle, and those neither running nor
 * stored. No deadline: downloads take what they take. Aborting `signal` closes the reply port
 * and rejects; without an abort, a Worker that never answers leaves this pending.
 */
export async function remainingDownloads(
  profile: string,
  signal?: AbortSignal,
): Promise<{ pending: number; missing: number }> {
  let report: { pending: number; missing: number } | undefined
  await within(
    null,
    (done, settled) => {
      const worker = navigator.serviceWorker.controller
      if (!worker) throw new Error('Missing controlling Service Worker')
      postPort(worker, { type: 'ceremony-downloads', profile }, settled, ({ data }) => {
        if (isCount(data?.pending) && isCount(data?.missing))
          report = { pending: data.pending, missing: data.missing }
        done(report ? undefined : new Error('Invalid download report'))
      })
    },
    { abort: signal },
  )
  return report!
}

/** Newly isolated documents can initially be uncontrolled; claim before execution fetches. */
export async function claimRootWorker(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const registration = await raceAbort(navigator.serviceWorker.getRegistration('/'), signal)
  if (registration?.scope !== `${location.origin}/` || !registration.active)
    throw new Error('Missing root Service Worker')
  if (navigator.serviceWorker.controller === registration.active) return
  await within(
    'Service Worker control timed out',
    (done, settled) => {
      const changed = () => {
        if (navigator.serviceWorker.controller === registration.active) done()
      }
      navigator.serviceWorker.addEventListener('controllerchange', changed, { signal: settled })
      postPort(registration.active!, { type: 'ceremony-claim' }, settled, changed)
      changed()
    },
    { abort: signal },
  )
}
