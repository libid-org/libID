import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { ceremonyError, type FailureCode, reportFailure } from '../../errors.js'
import { origin } from '../../primitives.js'
import { CancelCeremony, UUID } from '../index.js'
import { type OAuthReturn, proverFragment, route } from '../navigation.js'
import { view } from './ui.js'

/** The complete Callback artifact owns clearing and dispatch; the Bridge inserts data only. */
export function startCallback(): void {
  try {
    const oversized = location.search.length + location.hash.length > 32768
    const input = oversized
      ? undefined
      : Object.freeze({ query: location.search, fragment: location.hash })
    history.replaceState(null, '', location.origin + location.pathname)
    if (!input) throw new TypeError('OAuth return too large')
    const states = [
      ...new URLSearchParams(input.query).getAll('state'),
      ...new URLSearchParams(input.fragment.slice(1)).getAll('state'),
    ]
    const state = states.length === 1 ? /^v([1-9][0-9]*)\.(.+)$/.exec(states[0]) : null
    if (!state || !UUID.test(state[2])) throw new TypeError('Invalid OAuth state')
    // This closed dispatch retains only implementations supported by this artifact.
    if (state[1] !== '1') {
      view('This ceremony version is no longer supported. Update the application and try again.')
      return
    }
    const inputs: unknown = JSON.parse(
      document.getElementById('libid-callback-config')?.textContent ?? '',
      (_key, value) => (value && typeof value === 'object' ? Object.freeze(value) : value),
    )
    if (!Array.isArray(inputs)) throw new TypeError('Invalid Callback inputs')
    callbackV1(input, state[2], inputs)
  } catch (error) {
    const failure = ceremonyError(error, 'callback-input')
    view(`${failure.message} (${failure.code}) Return to your application.`)
    reportFailure(undefined, failure)
  }
}

function callbackV1(input: OAuthReturn, id: string, inputs: readonly unknown[]): void {
  const [allowedApplicationOrigins, ccdpOrigin] = inputs
  if (
    !Array.isArray(allowedApplicationOrigins) ||
    !allowedApplicationOrigins.length ||
    new Set(allowedApplicationOrigins).size !== allowedApplicationOrigins.length ||
    allowedApplicationOrigins.some((o) => !origin(o)) ||
    !origin(ccdpOrigin) ||
    !allowedApplicationOrigins.includes(ccdpOrigin)
  )
    throw new TypeError('Invalid Callback inputs')
  let connection: PopupConnection<Message> | undefined,
    ended = false,
    retained: OAuthReturn | undefined
  const cleanup = () => {
    ended = true
    retained = undefined
  }
  let failureCode: FailureCode = 'callback-connection'
  const fail = (error?: unknown) => {
    if (ended) return
    const failure = ceremonyError(error, failureCode)
    cleanup()
    view(`${failure.message} (${failure.code}) Return to your application.`)
    reportFailure(connection, failure)
  }
  try {
    retained = input
    view('Returning to your application')
    connection = PopupConnection.accept(PopupWindow.current(), {
      fallback,
      connectionId: id,
      allowedApplicationOrigins: [...allowedApplicationOrigins],
    })
    connection.on(CancelCeremony, () => {
      cleanup()
      view('Canceled. Return to your application.')
    })
    void connection.closed.then(() => {
      if (!ended) fail(ceremonyError(undefined, 'callback-connection'))
    })
    void connection.ready
      .then(async () => {
        if (ended || !retained) return
        try {
          connection!.send({ type: 'callback-ready' })
        } catch {
          /* Report no return parameters; a missed milestone cannot prevent navigation. */
        }
        failureCode = 'callback-navigation'
        const fragment = proverFragment(id, retained)
        await connection!.navigate(ccdpOrigin + route('prover'), fragment)
        cleanup()
      })
      .catch(fail)
  } catch (error) {
    fail(error)
  }
}
