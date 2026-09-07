import type { DistributedAsset } from '../../assets.js'
export const tlsnModule = {
  id: 'tlsn-module',
  mode: 'distributed',
  source: 'tlsn:tlsn_wasm.js',
  sha256: '4c852975717036cc9f5b3dff3b07f610b36ee01c05fa84003bb6034580898db2',
} as const satisfies DistributedAsset
export const tlsnWasm = {
  id: 'tlsn-wasm',
  mode: 'distributed',
  source: 'tlsn:tlsn_wasm_bg.wasm',
  sha256: 'fcfe23bdbaab4bf8349229e8fb9cefdfacea687543bed9072d5fdfb2c93a133e',
} as const satisfies DistributedAsset
export const notaryAssets = [tlsnModule, tlsnWasm] as const
