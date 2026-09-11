import * as assets from '../assets/index.js'

export const SRS_SIZE = 2 ** 18

export const acvm = assets.file(
  'npm:@noir-lang/acvm_js/web/acvm_js_bg.wasm',
  'noir/1.0.0-beta.25/acvm_js_bg.wasm',
  { ...assets.headers.immutable, ...assets.headers.wasm },
)

export const abi = assets.file(
  'npm:@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm',
  'noir/1.0.0-beta.25/noirc_abi_wasm_bg.wasm',
  { ...assets.headers.immutable, ...assets.headers.wasm },
)

export const bbWasm = {
  ...assets.file(
    'npm:@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz',
    'bb/5.2.0/wasm/barretenberg-threads.wasm',
    { ...assets.headers.immutable, ...assets.headers.wasm },
  ),
  bundledUrlModules: [
    '@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.js',
    '@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js',
  ],
}

const primary = 'https://crs.aztec-cdn.foundation',
  fallback = 'https://crs.aztec-labs.com'

export const crs = [
  assets.external(`${primary}/g1_compressed.dat`, {
    fallback: [`${fallback}/g1_compressed.dat`],
    range: `bytes=0-${SRS_SIZE * 32 - 1}`,
  }),
  assets.external(`${primary}/g2.dat`, { fallback: [`${fallback}/g2.dat`], bytes: 128 }),
  assets.external(`${primary}/grumpkin_g1_v2.dat`, {
    fallback: [`${fallback}/grumpkin_g1_v2.dat`],
    range: `bytes=0-${2 ** 16 * 64 - 1}`,
  }),
] as const

export const proofAssets = [acvm, abi, bbWasm, ...crs] as const
