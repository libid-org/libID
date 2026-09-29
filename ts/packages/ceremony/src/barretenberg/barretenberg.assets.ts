import * as assets from '../assets/index.js'

// One shared CRS serves every current circuit. The browser loader uses 4 MiB chunks
// (at least 2^17 points); oidc_google needs 2^18. Capacity is checked in build/circuits.ts.
export const SRS_SIZE = 2 ** 18

const noirWasm = (pkg: string, name: string) =>
  assets.file(`npm:@noir-lang/${pkg}/web/${name}`, `noir/1.0.0-beta.25/${name}`, {
    ...assets.headers.immutable,
    ...assets.headers.wasm,
  })

export const acvm = noirWasm('acvm_js', 'acvm_js_bg.wasm')

export const abi = noirWasm('noirc_abi', 'noirc_abi_wasm_bg.wasm')

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

// bb.js 5.2.0 browser fetches ignore crsPath as an override. Keep these external
// and matched to its native URLs/ranges; build/loaders.test.ts observes real loaders.
const crsFile = (name: string, request: { range: string } | { bytes: number }) =>
  assets.external(`https://crs.aztec-cdn.foundation/${name}`, {
    fallback: [`https://crs.aztec-labs.com/${name}`],
    ...request,
  })

export const crs = [
  crsFile('g1_compressed.dat', { range: `bytes=0-${SRS_SIZE * 32 - 1}` }),
  crsFile('g2.dat', { bytes: 128 }),
  crsFile('grumpkin_g1_v2.dat', { range: `bytes=0-${2 ** 16 * 64 - 1}` }),
] as const

export const proofAssets = [acvm, abi, bbWasm, ...crs] as const
