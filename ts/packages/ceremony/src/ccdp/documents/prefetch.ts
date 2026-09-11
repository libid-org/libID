import { requestsByProfile } from 'virtual:ceremony-assets'
import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { ceremonyError, type FailureCode, reportFailure } from '../../errors.js'
import { dispatchPrefetch, rootWorker } from '../../assets/registration.js'
import { startWorker } from '../../assets/worker.js'
import { view } from '../../ui.js'
import { readPrefetch } from '../navigation.js'
export async function startPrefetch(fragment: string): Promise<void> {
  let connection: PopupConnection<Message> | undefined
  let failureCode: FailureCode = 'prefetch-input'
  try {
    const input = readPrefetch(fragment),
      profile = `${input.platformId}/${input.platformCeremonyVersion}`
    if (!Object.hasOwn(requestsByProfile, profile)) throw new Error('Unsupported profile')
    view('Preparing your ceremony')
    failureCode = 'prefetch-connection'
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: '*',
    })
    await connection.ready
    try {
      connection.send({ type: 'prefetch-ready' })
    } catch {
      /* Advisory readiness cannot decide the ceremony outcome. */
    }
    failureCode = 'prefetch-worker'
    const registration = await rootWorker()
    await dispatchPrefetch(registration, profile)
    connection.send({ type: 'prefetch-started' })
  } catch (error) {
    const failure = ceremonyError(error, failureCode)
    view(`${failure.message} (${failure.code}) Return to your application.`)
    reportFailure(connection, failure)
  }
}
if (typeof document === 'undefined') startWorker(self as unknown as ServiceWorkerGlobalScope)
