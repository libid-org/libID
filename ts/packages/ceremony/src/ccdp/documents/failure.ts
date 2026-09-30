// How a CCDP document ends and reports a failed run; the workers need none of this.

import { type ConnectionEnd, type Message, type PopupConnection, PopupError } from '@libid/popup'
import type { CeremonyError } from '../../errors.js'
import { isOrigin } from '../../primitives.js'

/** A failed end keeps its transport code; an orderly close fails the document's own run with `closedMessage`. */
export const endError = (end: ConnectionEnd, closedMessage: string): Error =>
  end.outcome === 'failed' ? new PopupError(end.code) : new Error(closedMessage)

/**
 * Only an authenticated peer receives CeremonyFailed. Failure to deliver it is recorded
 * locally without exposing its opaque text to telemetry.
 */
export function reportFailure(
  connection: PopupConnection<Message> | undefined,
  error: CeremonyError,
): void {
  try {
    if (connection && isOrigin(connection.peerOrigin)) {
      const message = { type: 'ceremony-failed', event: error.event, message: error.message }
      connection.send(message)
      return
    }
  } catch {
    /* Reporting cannot replace the original failure. */
  }
  try {
    console.error('[ceremony] failure report unavailable')
  } catch {}
}
