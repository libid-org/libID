import { MAX_FAILURE_TEXT_BYTES } from './ccdp/limits.js'
import { isText } from './primitives.js'

/** The display text of a failure that carries none of its own. */
export const FAILED_TEXT = 'Ceremony failed.'

/** Opaque display text only: never serialize an exception object, stack, or nested causes. */
export const errorMessage = (error: unknown): string => displayText(describe(error))

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : FAILED_TEXT
}

const utf8 = new TextEncoder()

/** Controls become spaces; the byte bound cuts at a character boundary, never inside a pair. */
function displayText(message: string): string {
  const clean = message.replace(/\p{Cc}/gu, ' ').trim()
  const { read } = utf8.encodeInto(clean, new Uint8Array(MAX_FAILURE_TEXT_BYTES))
  const bounded = clean.slice(0, read)
  return isText(bounded, MAX_FAILURE_TEXT_BYTES) ? bounded : FAILED_TEXT
}

/** A failed operation and its displayable explanation; no error-code catalog beyond `reason`. */
export class CeremonyError extends Error {
  readonly event: string
  /** Local connection closure is an interruption, distinct from a technical failure. */
  readonly status: 'failed' | 'closed'
  /**
   * The one stable reason: the platform refused the authorization code as expired, after the
   * code's lifetime, so the person's connection set up the proof too slowly.
   */
  readonly reason?: 'authorization-expired'

  constructor(
    event: string,
    message: string,
    options?: ErrorOptions & { status?: 'failed' | 'closed'; reason?: 'authorization-expired' },
  ) {
    super(displayText(message), options)
    this.name = 'CeremonyError'
    this.event = event
    this.status = options?.status ?? 'failed'
    if (options?.reason) this.reason = options.reason
  }
}

export function toCeremonyError(error: unknown, event: string): CeremonyError {
  return error instanceof CeremonyError
    ? error
    : new CeremonyError(event, describe(error), { cause: error })
}
