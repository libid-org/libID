import type { Families, LedgerAccess, LedgerClient } from './client.js'
import type { Family, Ledger } from './index.js'

/** What each ledger family provides so the conformance suite can test its client. */
export interface Harness<F extends Family> {
  /** A fresh fake chain with its own chain id, a client on it, and a wallet authorized on it. */
  setup(): Fake<F>
}

export interface Fake<F extends Family> {
  readonly ledger: Ledger<F>
  /** How a client reaches the fake chain, for composing clients over several fakes. */
  readonly access: LedgerAccess<Ledger<F>>
  /** A client serving only this ledger. */
  readonly client: LedgerClient<Ledger<F>>
  /** Authorized for `accounts.raw` and on the client's chain. */
  readonly wallet: Families[F]['wallet']
  /** Reads a value that differs between any two chain states. */
  probe(read: Families[F]['reader']): Promise<unknown>
  /** A transaction that simulates successfully. */
  readonly tx: Families[F]['tx']
  /** A transaction whose simulation fails. */
  readonly reverting: Families[F]['tx']
  /** `raw` parses to `canonical`; `other` is a different valid account; `invalid` is not one. */
  readonly accounts: {
    readonly raw: string
    readonly canonical: string
    readonly other: string
    readonly invalid: string
  }
  /** Moves the chain to a new state. */
  advance(): void
  /** The account the wallet shares with the page; `null` shares none. */
  shareAccount(raw: string | null): void
  /** Moves the wallet to another chain. */
  leaveChain(): void
  /** The wallet's user declines the next request of this kind. */
  decline(request: 'accounts' | 'send'): void
  /** The next send fails after the wallet has received it. */
  loseSend(): void
  /** Wallet requests that could show wallet UI. */
  readonly prompts: number
  /** Transactions the wallet accepted for sending. */
  readonly sent: number
}
