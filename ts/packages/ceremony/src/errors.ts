import type { Message, PopupConnection } from '@libid/popup'
import { text } from './primitives.js'

/** Opaque display text only: never serialize an exception object, stack, or nested causes. */
export function errorMessage(error: unknown): string {
  let message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ceremony failed.'
  message = message.replace(/\p{Cc}/gu, ' ').trim()
  while (new TextEncoder().encode(message).length > 2048)
    message = message.slice(0, Math.floor(message.length * 0.9))
  return text(message, 2048) ? message : 'Ceremony failed.'
}

/** A failed operation and its displayable explanation; no stable error-code catalog. */
export class CeremonyError extends Error {
  constructor(
    readonly event: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(errorMessage(message), options)
    this.name = 'CeremonyError'
  }
}

export function ceremonyError(error: unknown, event: string): CeremonyError {
  return error instanceof CeremonyError
    ? error
    : new CeremonyError(event, errorMessage(error), { cause: error })
}

/** Failure to deliver an Abort is recorded locally without exposing its opaque text to telemetry. */
export function reportFailure(
  connection: PopupConnection<Message> | undefined,
  error: CeremonyError,
): void {
  try {
    if (connection) {
      const message = { type: 'abort', event: error.event, message: error.message }
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
