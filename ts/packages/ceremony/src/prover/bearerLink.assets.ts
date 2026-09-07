import type { DistributedAsset } from '../assets.js'
export const bearerCircuit = {
  id: 'bearer_link',
  mode: 'distributed',
  source: 'circuit:bearer_link.json',
  sha256: 'ffa27aa82e60b4ff2ab41117955ef895ecabaf2d42b6930ebcd06324cfbf0ef9',
} as const satisfies DistributedAsset
