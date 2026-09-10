import type { AbortCeremony } from './ccdp/index.js'
import type { Message, PopupConnection } from '@libid/popup'

export const failureMessages = {
  'callback-input': 'Invalid OAuth callback or deployment configuration.',
  'callback-connection': 'Unable to connect the OAuth callback.',
  'callback-navigation': 'Unable to navigate from Callback to Prover.',
  'prefetch-input': 'Invalid prefetch request.',
  'prefetch-connection': 'Unable to connect Prefetch.',
  'prefetch-worker': 'Unable to prepare the prefetch worker or dispatch assets.',
  'prover-input': 'Invalid Prover navigation input.',
  'prover-connection': 'Unable to connect Prover.',
  'prover-request': 'Invalid proving request.',
  'prover-isolation': 'Required browser isolation is unavailable.',
  'prover-worker': 'Unable to claim the proving resource worker.',
  'oauth-return': 'Invalid OAuth return or provider authorization error.',
  'token-exchange': 'OAuth token exchange or response validation failed.',
  notarization: 'Notarization failed.',
  proof: 'Proof engine failed.',
  'prover-execution': 'Unable to complete the platform proof.',
} as const
export type FailureCode = keyof typeof failureMessages

/** A cause stays in the context that caught it; only the code and catalog message cross CCDP. */
export class CeremonyError extends Error {
  constructor(
    readonly code: FailureCode,
    options?: ErrorOptions,
  ) {
    super(failureMessages[code], options)
    this.name = 'CeremonyError'
  }
}
export function ceremonyError(error: unknown, code: FailureCode): CeremonyError {
  return error instanceof CeremonyError ? error : new CeremonyError(code, { cause: error })
}
export function reportFailure(
  connection: PopupConnection<Message> | undefined,
  error: CeremonyError,
): void {
  try {
    if (connection) {
      const message: AbortCeremony = {
        type: 'abort-ceremony',
        code: error.code,
        reason: failureMessages[error.code],
      }
      connection.send(message)
      return
    }
  } catch {
    // The original failure remains available locally; reporting cannot change the outcome.
  }
  try {
    console.error(`[ceremony] ${error.code}`)
  } catch {}
}
