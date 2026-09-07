import type { LedgerId } from '@libid/ledger'
import { notaryAddresses } from 'virtual:ceremony-assets'

export function resolveNotaryAddress(ledgerId: LedgerId): string {
  return notaryAddresses[ledgerId.isTestnet() ? 1 : 0]
}
