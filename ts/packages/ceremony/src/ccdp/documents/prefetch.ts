import { requestsByProfile } from 'virtual:ceremony-assets'
import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { dispatchPrefetch, rootWorker } from '../../assets/registration.js'
import { startWorker } from '../../assets/worker.js'
import { ceremonyError, reportFailure } from '../../errors.js'
import { Events, now } from '../../events.js'
import { readPrefetch } from '../navigation.js'
import { eventView } from './ui.js'

/** Authenticate the Prefetch page and acknowledge selected fetch dispatch before OAuth navigation. */
export async function startPrefetch(fragment: string): Promise<void> {
  let connection: PopupConnection<Message> | undefined
  const events = new Events()
  const ui = eventView(events, '')
  try {
    const input = readPrefetch(fragment),
      profile = `${input.platformId}/${input.platformCeremonyVersion}`
    if (!Object.hasOwn(requestsByProfile, profile)) throw new Error('Unsupported profile')
    events.emit({
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
    const registration = await rootWorker()
    await dispatchPrefetch(registration, profile)
    const event = { event: 'prefetch-dispatch', phase: 'finished', timestamp: now() } as const
    connection.send({ type: 'event', ...event })
    events.emit({ ...event, status: 'active' })
  } catch (error) {
    const failure = ceremonyError(error, 'prefetch-dispatch')
    events.emit({
      status: 'failed',
      event: failure.event,
      message: failure.message,
      timestamp: now(),
    })
    reportFailure(connection, failure)
  } finally {
    ui.stop()
  }
}

if (typeof document === 'undefined') startWorker(self as unknown as ServiceWorkerGlobalScope)
