import { fallback } from 'virtual:ceremony-popup-fallback'
import { PopupConnection, PopupWindow } from '@libid/popup'
import { ceremonyError, endError, reportFailure } from '../../errors.js'
import { Events, failureEvent, now } from '../../events.js'
import { isOrigin } from '../../primitives.js'
import { MAX_OAUTH_RETURN_CHARS } from '../limits.js'
import { type OAuthReturn, proverFragment, readOAuthState, route } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { eventView, view } from './ui.js'

/** The complete Callback artifact owns clearing and dispatch; the Bridge inserts data only. */
export function startCallback(): void {
  try {
    const oversized = location.search.length + location.hash.length > MAX_OAUTH_RETURN_CHARS
    const input = oversized
      ? undefined
      : Object.freeze({ query: location.search, fragment: location.hash })
    history.replaceState(null, '', location.origin + location.pathname)
    if (!input) throw new TypeError(messages.oauthReturnTooLarge)
    const states = [
      ...new URLSearchParams(input.query).getAll('state'),
      ...new URLSearchParams(input.fragment.slice(1)).getAll('state'),
    ]
    const state = states.length === 1 ? readOAuthState(states[0]) : null
    if (!state) throw new TypeError(messages.invalidOAuthState)
    // This closed dispatch retains only implementations supported by this artifact.
    if (state.version !== '1') {
      view(messages.unsupportedVersion)
      return
    }
    callbackV1(input, state.ceremonyId, deploymentInputs())
  } catch (error) {
    const failure = ceremonyError(error, 'authorization')
    view(messages.returnToApplication(failure.message))
    reportFailure(undefined, failure)
  }
}

/** A missing, malformed or non-list slot is invalid deployment data, not a parser message. */
function deploymentInputs(): readonly unknown[] {
  let inputs: unknown
  try {
    inputs = JSON.parse(
      document.getElementById('libid-callback-config')?.textContent ?? '',
      (_key, value) => (value && typeof value === 'object' ? Object.freeze(value) : value),
    )
  } catch {
    /* Reported below. */
  }
  if (!Array.isArray(inputs)) throw new TypeError(messages.invalidCallbackInputs)
  return inputs
}

function callbackV1(input: OAuthReturn, id: string, inputs: readonly unknown[]): void {
  const [allowedApplicationOrigins, ccdpOrigin] = inputs
  if (
    !Array.isArray(allowedApplicationOrigins) ||
    !isOrigin(ccdpOrigin) ||
    !allowedApplicationOrigins.includes(ccdpOrigin)
  )
    throw new TypeError(messages.invalidCallbackInputs)
  // Popup owns validation and matching of the Bridge's admission patterns.
  const connection = PopupConnection.accept(PopupWindow.current(), {
    fallback,
    connectionId: id,
    allowedApplicationOrigins,
  })
  let state: { phase: 'connecting'; input: OAuthReturn } | { phase: 'navigating' | 'ended' } = {
    phase: 'connecting',
    input,
  }
  const events = new Events()
  const ui = eventView(events)
  const cleanup = () => {
    state = { phase: 'ended' }
    ui.stop()
  }
  const fail = (error: unknown) => {
    if (state.phase === 'ended') return
    const failure = ceremonyError(error, 'authorization')
    events.emit(failureEvent(failure))
    cleanup()
    reportFailure(connection, failure)
  }
  ui.message(messages.returning)
  void connection.closed.then((end) => {
    if (state.phase !== 'navigating' || end.outcome === 'failed')
      fail(endError(end, messages.callbackClosed))
  })
  void connection.ready
    .then(async () => {
      if (state.phase !== 'connecting') return
      const applicationOrigin = connection.peerOrigin
      if (!isOrigin(applicationOrigin)) throw new TypeError(messages.missingApplicationOrigin)
      const event = { event: 'authorization', phase: 'finished', timestamp: now() } as const
      try {
        connection.send({ type: 'event', ...event })
      } catch {
        /* A lost observation does not gate navigation. */
      }
      events.emit({ ...event, status: 'active' })
      const fragment = proverFragment(id, applicationOrigin, state.input)
      state = { phase: 'navigating' }
      await connection.navigate(ccdpOrigin + route('prover'), fragment)
      cleanup()
    })
    .catch(fail)
}
