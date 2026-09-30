import { requestsByProfile } from 'virtual:ceremony-assets'
import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { dispatchPrefetch, registerRootWorker } from '../../assets/registration.js'
import { startWorker } from '../../assets/worker.js'
import { reportFailure, toCeremonyError } from '../../errors.js'
import { EventFeed, failureEvent, now } from '../../events.js'
import { readPrefetch } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { eventView } from './ui.js'

/** Authenticate the Prefetch page and acknowledge selected fetch dispatch before OAuth navigation. */
export async function startPrefetch(fragment: string): Promise<void> {
  const started = performance.now()
  let connection: PopupConnection<Message> | undefined
  const feed = new EventFeed()
  const ui = eventView(feed)
  try {
    const input = readPrefetch(fragment),
      profile = `${input.platformId}/${input.platformCeremonyVersion}`
    if (!Object.hasOwn(requestsByProfile, profile)) throw new Error(messages.unsupportedProfile)
    feed.emit({
      event: 'prefetch-dispatch',
      phase: 'started',
      timestamp: now(),
      status: 'active',
    })
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: '*',
    })
    await connection.ready
    const connected = performance.now()
    const registration = await registerRootWorker()
    const workerReady = performance.now()
    await dispatchPrefetch(registration, profile)
    const dispatched = performance.now()
    const event = {
      event: 'prefetch-dispatch',
      phase: 'finished',
      timestamp: performance.timeOrigin + dispatched,
      instrumentation: {
        attributes: {
          // Navigation to entry execution includes document and module loading.
          'document-startup-ms': started,
          'connection-ms': connected - started,
          'worker-ready-ms': workerReady - connected,
          'dispatch-ms': dispatched - workerReady,
        },
      },
    } as const
    connection.send({ type: 'event', ...event })
    feed.emit({ ...event, status: 'active' })
  } catch (error) {
    const failure = toCeremonyError(error, 'prefetch-dispatch')
    feed.emit(failureEvent(failure))
    reportFailure(connection, failure)
  } finally {
    ui.stop()
  }
}

if (typeof document === 'undefined') startWorker(self as unknown as ServiceWorkerGlobalScope)
