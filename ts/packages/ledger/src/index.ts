/** Ledger definitions own their Chain Profile hash and notary routing. */
export interface LedgerId {
  hash(): Uint8Array
  notaryAddress(): string
}
