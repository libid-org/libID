import { type Message, type PopupConnection, PopupError } from '@libid/popup'
import { messages, popupErrorMessages } from './ccdp/ui-messages.js'
import { text } from './primitives.js'

/** Opaque display text only: never serialize an exception object, stack, or nested causes. */
export function errorMessage(error: unknown): string {
  let message =
    error instanceof PopupError
      ? popupErrorMessages[error.code]
      : error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : messages.failed
  message = message.replace(/\p{Cc}/gu, ' ').trim()
  while (new TextEncoder().encode(message).length > 2048)
    message = message.slice(0, Math.floor(message.length * 0.9))
  return text(message, 2048) ? message : messages.failed
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
    super(errorMessage(message), options)
    this.name = 'CeremonyError'
    this.status = options?.status ?? 'failed'
  }
}

export function ceremonyError(error: unknown, event: string): CeremonyError {
  return error instanceof CeremonyError
    ? error
    : new CeremonyError(event, errorMessage(error), { cause: error })
}

/** Failure to deliver an CeremonyFailed is recorded locally without exposing its opaque text to telemetry. */
export function reportFailure(
  connection: PopupConnection<Message> | undefined,
  error: CeremonyError,
): void {
  try {
    if (connection) {
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
