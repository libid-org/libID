import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { route } from '../../assets/keys.js'
import { isOrigin } from '../../primitives.js'
import { ccdpError, endError, reportFailure } from '../failure.js'
import type { EventMessage } from '../index.js'
import { MAX_NAVIGATION_FRAGMENT_CHARS, MAX_OAUTH_RETURN_CHARS } from '../limits.js'
import { type OAuthReturn, proverFragment, readOAuthState } from '../navigation.js'
import { messages } from '../uiMessages.js'
import { adoptShell, view } from './ui.js'

/** The complete Callback artifact owns clearing and dispatch; the Bridge inserts data only. */
export function startCallback(): void {
  try {
    const oversized = location.search.length + location.hash.length > MAX_OAUTH_RETURN_CHARS
    const oauthReturn = oversized
      ? undefined
      : Object.freeze({ query: location.search, fragment: location.hash })
    history.replaceState(null, '', location.origin + location.pathname)
    if (!oauthReturn) throw new TypeError(messages.oauthReturnTooLarge)
    const states = [
      ...new URLSearchParams(oauthReturn.query).getAll('state'),
      ...new URLSearchParams(oauthReturn.fragment.slice(1)).getAll('state'),
    ]
    const returnState = states.length === 1 ? readOAuthState(states[0]) : null
    if (!returnState) throw new TypeError(messages.invalidOAuthState)
    // This closed dispatch retains only implementations supported by this artifact.
    if (returnState.ccdpVersion !== '1') {
      view(messages.unsupportedVersion)
      return
    }
    callbackV1(oauthReturn, returnState.ceremonyId, deploymentInputs())
  } catch (error) {
    const failure = ccdpError(error, 'authorization')
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

function callbackV1(oauthReturn: OAuthReturn, id: string, inputs: readonly unknown[]): void {
  const [allowedApplicationOrigins, ccdpOrigin] = inputs
  if (
    !Array.isArray(allowedApplicationOrigins) ||
    !isOrigin(ccdpOrigin) ||
    !allowedApplicationOrigins.includes(ccdpOrigin)
  )
    throw new TypeError(messages.invalidCallbackInputs)
  // Popup owns validation and matching of the Bridge's admission patterns. Callback always arrives
  // from a cross-origin OAuth provider, so no worker on the Bridge origin can hold a kept port.
  const connection = PopupConnection.accept(PopupWindow.current(), {
    connectionId: id,
    allowedApplicationOrigins,
    claim: false,
  })
  void new CallbackDocument(connection, id, oauthReturn, ccdpOrigin).start()
}

/** Forwards the one OAuth return from the Bridge to the Prover, navigating the popup there. */
class CallbackDocument {
  /** The return until navigation hands it to the Prover. */
  #oauthReturn: OAuthReturn | null
  #ended = false
  readonly #shell = adoptShell(messages.proofPreparation)

  constructor(
    private readonly connection: PopupConnection<Message>,
    private readonly id: string,
    oauthReturn: OAuthReturn,
    private readonly ccdpOrigin: string,
  ) {
    this.#oauthReturn = oauthReturn
  }

  async start(): Promise<void> {
    // The label the Prover continues with: this hop takes milliseconds, too fast for its own.
    this.#shell.message(messages.proofPreparation)
    // Its own navigation ends the connection; only a failure ends it early then.
    void this.connection.closed.then((end) => {
      if (!(this.#oauthReturn === null && end.outcome !== 'failed'))
        this.fail(endError(end, messages.callbackClosed))
    })
    try {
      await this.connection.ready
      if (this.#ended || this.#oauthReturn === null) return
      const applicationOrigin = this.connection.peerOrigin
      if (!isOrigin(applicationOrigin)) throw new TypeError(messages.missingApplicationOrigin)
      const fragment = proverFragment(this.id, applicationOrigin, this.#oauthReturn)
      // Re-encoding grows the return; validate before emitting authorization/finished or navigating.
      if (String(fragment).length >= MAX_NAVIGATION_FRAGMENT_CHARS)
        throw new TypeError(messages.oauthReturnTooLarge)
      const observation: EventMessage = {
        type: 'event',
        event: 'authorization',
        phase: 'finished',
        timestamp: performance.timeOrigin + performance.now(),
      }
      try {
        this.connection.send(observation)
      } catch {
        /* A lost observation does not gate navigation. */
      }
      this.#oauthReturn = null
      await this.connection.navigate(this.ccdpOrigin + route('prover'), fragment)
      this.#ended = true
    } catch (error) {
      this.fail(error)
    }
  }

  /** Drop the captured return and report failure once, updating the shell in place. */
  private fail(error: unknown): void {
    if (this.#ended) return
    this.#ended = true
    this.#oauthReturn = null
    const failure = ccdpError(error, 'authorization')
    this.#shell.fail(messages.returnToApplication(failure.message))
    reportFailure(this.connection, failure)
  }
}
