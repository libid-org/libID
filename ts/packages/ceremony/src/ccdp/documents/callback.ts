import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupError, PopupWindow } from '@libid/popup'
import { ceremonyError, reportFailure } from '../../errors.js'
import { Events, now } from '../../events.js'
import { origin } from '../../primitives.js'
import { UUID } from '../index.js'
import { type OAuthReturn, proverFragment, route } from '../navigation.js'
import { messages } from '../ui-messages.js'
import { eventView, view } from './ui.js'

/** The complete Callback artifact owns clearing and dispatch; the Bridge inserts data only. */
export function startCallback(): void {
  try {
    const oversized = location.search.length + location.hash.length > 32768
    const input = oversized
      ? undefined
      : Object.freeze({ query: location.search, fragment: location.hash })
    history.replaceState(null, '', location.origin + location.pathname)
    if (!input) throw new TypeError(messages.oauthReturnTooLarge)
    const states = [
      ...new URLSearchParams(input.query).getAll('state'),
      ...new URLSearchParams(input.fragment.slice(1)).getAll('state'),
    ]
    const state = states.length === 1 ? /^v([1-9][0-9]*)\.(.+)$/.exec(states[0]) : null
    if (!state || !UUID.test(state[2])) throw new TypeError(messages.invalidOAuthState)
    // This closed dispatch retains only implementations supported by this artifact.
    if (state[1] !== '1') {
      view(messages.unsupportedVersion)
      return
    }
    const inputs: unknown = JSON.parse(
      document.getElementById('libid-callback-config')?.textContent ?? '',
      (_key, value) => (value && typeof value === 'object' ? Object.freeze(value) : value),
    )
    if (!Array.isArray(inputs)) throw new TypeError(messages.invalidCallbackInputs)
    callbackV1(input, state[2], inputs)
  } catch (error) {
    const failure = ceremonyError(error, 'authorization')
    view(messages.returnToApplication(failure.message))
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
    throw new TypeError(messages.invalidCallbackInputs)
  let connection: PopupConnection<Message> | undefined,
    ended = false,
    retained: OAuthReturn | undefined
  const cleanup = () => {
    ended = true
    retained = undefined
  }
  const events = new Events()
  const ui = eventView(events, '')
  const fail = (error?: unknown) => {
    if (ended) return
    const failure = ceremonyError(error, 'authorization')
    cleanup()
    events.emit({
      status: 'failed',
      event: failure.event,
      message: failure.message,
      timestamp: now(),
    })
    ui.stop()
    reportFailure(origin(connection?.peerOrigin) ? connection : undefined, failure)
  }
  try {
    retained = input
    ui.message(messages.returning)
    connection = PopupConnection.accept(PopupWindow.current(), {
      fallback,
      connectionId: id,
      allowedApplicationOrigins: [...allowedApplicationOrigins],
    })

    void connection.closed.then((end) => {
      if (!ended)
        fail(
          end.outcome === 'failed' ? new PopupError(end.code) : new Error(messages.callbackClosed),
        )
    })
    void connection.ready
      .then(async () => {
        if (ended || !retained) return
        const applicationOrigin = connection!.peerOrigin
        if (!origin(applicationOrigin)) throw new TypeError(messages.missingApplicationOrigin)
        const event = { event: 'authorization', phase: 'finished', timestamp: now() } as const
        try {
          connection!.send({ type: 'event', ...event })
        } catch {
          /* A lost observation does not gate navigation. */
        }
        events.emit({ ...event, status: 'active' })
        const fragment = proverFragment(id, applicationOrigin, retained)
        await connection!.navigate(ccdpOrigin + route('prover'), fragment)
        cleanup()
        ui.stop()
      })
      .catch(fail)
  } catch (error) {
    fail(error)
  }
}
