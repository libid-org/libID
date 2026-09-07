import { fallback } from 'virtual:ceremony-popup-fallback'
import { AbortCeremony } from '../index.js'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { CancelCeremony, origin } from '../index.js'
import { ceremonyIdFromState, proverFragment, route, type OAuthReturn } from '../navigation.js'
import { hasExactKeys, isRecord } from '../../primitives.js'
import { view } from '../../ui.js'
export function callbackState(input: OAuthReturn): string {
  const states = [
    ...new URLSearchParams(input.query).getAll('state'),
    ...new URLSearchParams(input.fragment.slice(1)).getAll('state'),
  ]
  if (states.length !== 1) throw new Error('Invalid OAuth state')
  return ceremonyIdFromState(states[0])
}
export function startCallback(
  ...args: [input: OAuthReturn, allowedApplicationOrigins: readonly string[], ccdpOrigin: string]
): void {
  const [input, allowedApplicationOrigins, ccdpOrigin] = args
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
    if (
      args.length !== 3 ||
      !isRecord(input) ||
      !hasExactKeys(input, ['query', 'fragment']) ||
      typeof input.query !== 'string' ||
      typeof input.fragment !== 'string' ||
      input.query.length + input.fragment.length > 32768 ||
      (input.query !== '' && !input.query.startsWith('?')) ||
      (input.fragment !== '' && !input.fragment.startsWith('#')) ||
      !Array.isArray(allowedApplicationOrigins) ||
      !allowedApplicationOrigins.length ||
      new Set(allowedApplicationOrigins).size !== allowedApplicationOrigins.length ||
      allowedApplicationOrigins.some((o) => !origin(o)) ||
      !origin(ccdpOrigin)
    )
      throw new TypeError('Invalid Callback inputs')
    retained = { ...input }
    const id = callbackState(retained)
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
