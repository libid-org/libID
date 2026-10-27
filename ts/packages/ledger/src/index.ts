/** A ledger definition: the Notary Service its Platform Verifiers trust. */
export interface LedgerId {
  notaryAddress(): string
}
