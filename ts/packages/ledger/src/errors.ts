export type LedgerErrorCode =
  | 'rejected'
  | 'no-account'
  | 'wrong-chain'
  | 'wallet-changed'
  | 'not-sent'
  | 'indexer-unavailable'

const messages: Record<LedgerErrorCode, string> = {
  rejected: 'The wallet request was rejected.',
  'no-account': 'The wallet shared no account.',
  'wrong-chain': 'The wallet is not on this ledger.',
  'wallet-changed': 'The wallet account or chain changed.',
  'not-sent': 'The transaction was not sent.',
  'indexer-unavailable': 'The indexer is unavailable, behind, or not indexing this deployment.',
}

/** A wallet, send or indexer failure. From `Session.send`, any `LedgerError` means nothing was sent. */
export class LedgerError extends Error {
  override readonly name = 'LedgerError'
  constructor(
    readonly code: LedgerErrorCode,
    options?: { cause?: unknown },
  ) {
    super(messages[code], options)
  }
}

/** The first numeric EIP-1193 code in an error or its causes. */
export function errorCode(error: unknown): number | undefined {
  let value = error
  for (let i = 0; i < 8 && value && typeof value === 'object'; i++) {
    if ('code' in value && typeof value.code === 'number') return value.code
    value = 'cause' in value ? value.cause : undefined
  }
}
