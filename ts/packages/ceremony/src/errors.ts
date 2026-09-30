import { type ConnectionEnd, type Message, type PopupConnection, PopupError } from '@libid/popup'
import { messages, popupErrorMessages } from './ccdp/ui-messages.js'
import { isOrigin, isText } from './primitives.js'

/** UTF-8 bound on displayable failure text, including `CeremonyFailed.message`. */
export const MAX_MESSAGE_BYTES = 2048

/** Opaque display text only: never serialize an exception object, stack, or nested causes. */
export const errorMessage = (error: unknown): string => displayText(describe(error))

function describe(error: unknown): string {
  if (error instanceof PopupError) return popupErrorMessages[error.code]
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : messages.failed
}

/** Controls become spaces; the byte bound cuts at a character boundary, never inside a pair. */
function displayText(message: string): string {
  const clean = message.replace(/\p{Cc}/gu, ' ').trim()
  const { read } = new TextEncoder().encodeInto(clean, new Uint8Array(MAX_MESSAGE_BYTES))
  const bounded = clean.slice(0, read)
  return isText(bounded, MAX_MESSAGE_BYTES) ? bounded : messages.failed
}

/** A failed operation and its displayable explanation; no stable error-code catalog. */
export class CeremonyError extends Error {
  /** Local connection closure is an interruption, distinct from a technical failure. */
  readonly status: 'failed' | 'closed'

  constructor(
    readonly event: string,
    message: string,
    options?: ErrorOptions & { status?: 'failed' | 'closed' },
  ) {
    super(displayText(message), options)
    this.name = 'CeremonyError'
    this.status = options?.status ?? 'failed'
  }
}

/** A failed end keeps its transport code; an orderly close is this participant's interruption. */
export const endError = (end: ConnectionEnd, closedMessage: string): Error =>
  end.outcome === 'failed' ? new PopupError(end.code) : new Error(closedMessage)

export function ceremonyError(error: unknown, event: string): CeremonyError {
  return error instanceof CeremonyError
    ? error
    : new CeremonyError(event, describe(error), { cause: error })
}

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
