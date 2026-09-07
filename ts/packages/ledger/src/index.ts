/** Canonical identity, hashing and network classification belong to the ledger implementation. */
export interface LedgerId {
  encode(): string
  hash(): Uint8Array
  isTestnet(): boolean
}

export const LedgerId = {
  decode(_value: unknown): LedgerId {
    throw new TypeError('No ledger definitions are available')
  },
}
