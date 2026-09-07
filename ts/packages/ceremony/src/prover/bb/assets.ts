import type { DistributedAsset, ExternalAsset } from '../../assets.js'
export const SRS_SIZE = 2 ** 18
export const acvm = {
  id: 'acvm',
  mode: 'distributed',
  source: 'npm:@noir-lang/acvm_js/web/acvm_js_bg.wasm',
} as const satisfies DistributedAsset
export const abi = {
  id: 'abi',
  mode: 'distributed',
  source: 'npm:@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm',
} as const satisfies DistributedAsset
export const bbWasm = {
  id: 'bb-wasm',
  mode: 'distributed',
  source: 'npm:@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz',
  bundledUrlModules: [
    '@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.js',
    '@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js',
  ],
} as const satisfies DistributedAsset
const primary = 'https://crs.aztec-cdn.foundation',
  fallback = 'https://crs.aztec-labs.com'
export const crs = [
  {
    id: 'g1',
    mode: 'external',
    urls: [`${primary}/g1_compressed.dat`, `${fallback}/g1_compressed.dat`],
    range: `bytes=0-${SRS_SIZE * 32 - 1}`,
    bytes: SRS_SIZE * 32,
  },
  { id: 'g2', mode: 'external', urls: [`${primary}/g2.dat`, `${fallback}/g2.dat`], bytes: 128 },
  {
    id: 'grumpkin',
    mode: 'external',
    urls: [`${primary}/grumpkin_g1_v2.dat`, `${fallback}/grumpkin_g1_v2.dat`],
    range: `bytes=0-${2 ** 16 * 64 - 1}`,
    bytes: 2 ** 16 * 64,
  },
] as const satisfies readonly ExternalAsset[]
export const proofAssets = [acvm, abi, bbWasm, ...crs] as const
