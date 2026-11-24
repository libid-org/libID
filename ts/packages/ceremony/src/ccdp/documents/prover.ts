import { PopupConnection, PopupWindow } from '@libid/popup'
import { route } from '../../assets/keys.js'
import { ccdpError, endError, reportFailure } from '../failure.js'
import { readProver } from '../navigation.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { view } from './ui.js'

/**
 * Accept the private callback fragment, run the selected prover once isolated and deliver one
 * terminal result. Non-isolated documents (e.g., Firefox/Safari before the COOP/COEP fallback hop)
 * never load the proving runtime, catalog, or crypto helpers.
 */
export async function startProver(fragment: string): Promise<void> {
  try {
    const input = readProver(fragment)
    // Popup reports the isolation hop just before it releases this page to the fallback.
    const hop = { leaving: false }
    const connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: [input.applicationOrigin],
      isolationFallbackUrl: location.origin + route('prover/fallback'),
      onDiagnostic: ({ code }) => {
        if (code === 'isolation-fallback') hop.leaving = true
      },
    })
    const isolated =
      crossOriginIsolated &&
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof Worker !== 'undefined'
    if (!isolated) {
      let ended = false
      const fail = (error: unknown) => {
        if (ended) return
        ended = true
        const failure = ccdpError(error, 'prover')
        view(messages.returnToApplication(failure.message))
        reportFailure(connection, failure)
      }
      void connection.closed.then((end) => {
        if (end.outcome === 'closed' && hop.leaving) ended = true
        else fail(endError(end, messages.proverClosed))
      })
      try {
        await connection.ready
        if (!ended) fail(new Error(popupErrorMessages['isolation-unavailable']))
      } catch (error) {
        fail(error)
      }
      return
    }
    const { runProver } = await import('./proverRuntime.js')
    await runProver(connection, input, hop)
  } catch (error) {
    const failure = ccdpError(error, 'prover')
    view(messages.returnToApplication(failure.message))
    reportFailure(undefined, failure)
  }
}
