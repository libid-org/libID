import { fallback } from 'virtual:ceremony-popup-fallback'
import { AbortCeremony } from '../ccdp/index.js'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { readPrefetch } from '../ccdp/navigation.js'
import { profiles } from 'virtual:ceremony-assets'
import { view } from '../ui.js'
import { rootWorker, dispatchPrefetch } from './registration.js'
import { startWorker } from './worker.js'
export async function startPrefetch(fragment: string): Promise<void> {
  let connection: PopupConnection<Message> | undefined
  try {
    const input = readPrefetch(fragment),
      profile = `${input.platformId}/${input.platformCeremonyVersion}`
    if (!Object.hasOwn(profiles, profile)) throw new Error('Unsupported profile')
    view('Preparing your ceremony')
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: '*',
    })
    await connection.ready
    const registration = await rootWorker()
    await dispatchPrefetch(registration, profile)
    connection.send({ type: 'prefetch-started' })
  } catch {
    view('Unable to prepare. Return to your application.')
    try {
      connection?.send(AbortCeremony.decode({ type: 'abort-ceremony', reason: 'Prefetch failed' }))
    } catch {}
  }
}
if (typeof document === 'undefined') startWorker(self as unknown as ServiceWorkerGlobalScope)
