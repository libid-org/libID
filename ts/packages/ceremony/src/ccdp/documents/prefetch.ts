import { requestsByProfile } from 'virtual:ceremony-assets'
import { rootWorkerUrl } from 'virtual:ceremony-worker'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { profileKey } from '../../assets/keys.js'
import { dispatchPrefetch, registerRootWorker } from '../../assets/registration.js'
import { now } from '../../events.js'
import { readPrefetch } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { CeremonyDocument } from './document.js'

/** Authenticate the Prefetch page and acknowledge selected fetch dispatch before OAuth navigation. */
export async function startPrefetch(fragment: string): Promise<void> {
  await new PrefetchDocument(performance.now()).start(fragment)
}

/** Dispatches the selected profile's asset fetches, then reports readiness to the Application. */
class PrefetchDocument extends CeremonyDocument {
  protected connection: PopupConnection<Message> | undefined

  /** `started` is the document's entry time, before any of its own work. */
  constructor(private readonly started: number) {
    super('prefetch-dispatch')
  }

  async start(fragment: string): Promise<void> {
    const started = this.started
    try {
      const input = readPrefetch(fragment)
      const profile = profileKey(input.platformId, input.platformCeremonyVersion)
      this.feed.emit({
        event: 'prefetch-dispatch',
        phase: 'started',
        timestamp: now(),
        status: 'active',
      })
      const connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
        connectionId: input.ceremonyId,
        allowedApplicationOrigins: '*',
      })
      this.connection = connection
      await connection.ready
      // Reported once connected, so the Application learns why instead of waiting.
      if (!Object.hasOwn(requestsByProfile, profile)) throw new Error(messages.unsupportedProfile)
      const connected = performance.now()
      // Registered only now, after the connection's registration lookup: Firefox can build this
      // document's registration from a lookup answered before the new Worker installs, and if
      // that Worker's claim arrives first, the Worker stays redundant here though active.
      const worker = await registerRootWorker(rootWorkerUrl)
      const workerReady = performance.now()
      const assets = await dispatchPrefetch(worker, profile)
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
            // Requests served from Cache Storage, and those fetched or joined to a fetch.
            ...(assets && { 'assets-cached': assets.cached, 'assets-fetched': assets.fetched }),
          },
        },
      } as const
      connection.send({ type: 'event', ...event })
      this.feed.emit({ ...event, status: 'active' })
      this.cleanup()
    } catch (error) {
      this.fail(error)
    }
  }
}
