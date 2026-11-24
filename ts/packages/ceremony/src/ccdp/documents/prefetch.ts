import { rootWorkerUrl } from 'virtual:ceremony-worker'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { profileKey } from '../../assets/keys.js'
import { dispatchPrefetch, drainJournal, registerRootWorker } from '../../assets/registration.js'
import { ccdpError, reportFailure } from '../failure.js'
import type { EventMessage } from '../index.js'
import { readPrefetch } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { adoptShell } from './ui.js'

/** Maximum grace window after asset dispatch to wait for diagnostic journal marks before OAuth. */
export const JOURNAL_GRACE_MS = 50

function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

/** Authenticate the Prefetch page and acknowledge selected fetch dispatch before OAuth navigation. */
export async function startPrefetch(fragment: string): Promise<void> {
  const started = performance.now()
  const shell = adoptShell(messages.preparation)
  let connection: PopupConnection<Message> | undefined
  try {
    const input = readPrefetch(fragment)
    const profile = profileKey(input.platformId, input.platformCeremonyVersion)
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: '*',
    })
    await connection.ready
    const connected = performance.now()
    // Registered only now, after the connection's registration lookup: Firefox can build this
    // document's registration from a lookup answered before the new Worker installs, and if
    // that Worker's claim arrives first, the Worker stays redundant here though active.
    const worker = await registerRootWorker(rootWorkerUrl)
    const workerReady = performance.now()
    const journal = drainJournal(worker)
    const assets = await dispatchPrefetch(worker, profile)
    const marks = await settleWithin(journal, JOURNAL_GRACE_MS, [])
    const dispatched = performance.now()
    // Before readiness: the Application may navigate away as soon as Prefetch finishes.
    for (const { event, phase, timestamp, operationId } of marks) {
      const kept: EventMessage = {
        type: 'event',
        event,
        ...(phase && { phase }),
        timestamp,
        instrumentation: { operationId },
      }
      connection.send(kept)
    }
    const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    const ready: EventMessage = {
      type: 'event',
      event: 'prefetch-dispatch',
      phase: 'finished',
      timestamp: performance.timeOrigin + dispatched,
      instrumentation: {
        attributes: {
          // Navigation to entry execution includes document and module loading.
          'document-startup-ms': started,
          // Where that startup waited, on the same clock: a Service Worker (0 when none was
          // involved), the request's start, and its first response byte.
          ...(navigation && {
            'navigation-worker-ms': navigation.workerStart,
            'navigation-fetch-ms': navigation.fetchStart,
            'navigation-response-ms': navigation.responseStart,
          }),
          'connection-ms': connected - started,
          'worker-ready-ms': workerReady - connected,
          'dispatch-ms': dispatched - workerReady,
          // Requests served from Cache Storage, and those fetched or joined to a fetch.
          ...(assets && { 'assets-cached': assets.cached, 'assets-fetched': assets.fetched }),
        },
      },
    }
    connection.send(ready)
  } catch (error) {
    const failure = ccdpError(error, 'prefetch-dispatch')
    shell.fail(messages.returnToApplication(failure.message))
    reportFailure(connection, failure)
  }
}
