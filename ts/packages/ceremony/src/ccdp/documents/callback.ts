import { fallback } from 'virtual:ceremony-popup-fallback'
import { AbortCeremony } from '../index.js'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { CancelCeremony, origin, UUID } from '../index.js'
import { proverFragment, route, type OAuthReturn } from '../navigation.js'
import { hasExactKeys, isRecord } from '../../primitives.js'
import { view } from '../../ui.js'
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
    const config: unknown = JSON.parse(
      document.getElementById('libid-callback-config')?.textContent ?? '',
    )
    if (
      !isRecord(config) ||
      !hasExactKeys(config, ['versionedInputs']) ||
      !isRecord(config.versionedInputs) ||
      Object.keys(config.versionedInputs).some((version) => !/^[1-9][0-9]*$/.test(version))
    )
      throw new TypeError('Invalid Callback configuration')
    const inputs: unknown = config.versionedInputs[state[1]]
    if (!Array.isArray(inputs) || inputs.length !== 2)
      throw new TypeError('Invalid Callback inputs')
    const [allowedApplicationOrigins, ccdpOrigin] = inputs
    if (
      !Array.isArray(allowedApplicationOrigins) ||
      !allowedApplicationOrigins.length ||
      new Set(allowedApplicationOrigins).size !== allowedApplicationOrigins.length ||
      allowedApplicationOrigins.some((o) => !origin(o)) ||
      !origin(ccdpOrigin)
    )
      throw new TypeError('Invalid Callback inputs')
    const frozen = Object.freeze([
      Object.freeze([...allowedApplicationOrigins]),
      ccdpOrigin,
    ] as const)
    callbackV1(input, state[2], ...frozen)
  } catch {
    view('Unable to continue. Return to your application.')
  }
}
function callbackV1(
  input: OAuthReturn,
  id: string,
  allowedApplicationOrigins: readonly string[],
  ccdpOrigin: string,
): void {
  let connection: PopupConnection<Message> | undefined,
    ended = false,
    retained: OAuthReturn | undefined
  const cleanup = () => {
    ended = true
    retained = undefined
  }
  const fail = () => {
    if (ended) return
    cleanup()
    view('Unable to continue. Return to your application.')
    try {
      connection?.send(AbortCeremony.decode({ type: 'abort-ceremony', reason: 'Callback failed' }))
    } catch {}
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
      if (!ended) fail()
    })
    void connection.ready
      .then(async () => {
        if (ended || !retained) return
        const fragment = proverFragment(id, retained)
        await connection!.navigate(ccdpOrigin + route('prover'), fragment)
        cleanup()
      })
      .catch(fail)
  } catch {
    fail()
  }
}
