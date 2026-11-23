import * as assets from '../assets/index.js'
import { G1_POINT_BYTES, G2_BYTES, SRS_POINTS } from './parameters.js'

const noirWasm = (pkg: string, name: string) =>
  assets.file(`npm:@noir-lang/${pkg}/web/${name}`, `noir/{version}/${name}`, {
    ...assets.headers.immutable,
    ...assets.headers.wasm,
  })

export const acvm = noirWasm('acvm_js', 'acvm_js_bg.wasm')

export const abi = noirWasm('noirc_abi', 'noirc_abi_wasm_bg.wasm')

export const bbWasm = {
  ...assets.file(
    'npm:@aztec-foundation/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz',
    'bb/{version}/wasm/barretenberg-threads.wasm',
    { ...assets.headers.immutable, ...assets.headers.wasm },
  ),
  bundledUrlModules: [
    '@aztec-foundation/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.js',
    '@aztec-foundation/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js',
  ],
}

/** bb.js takes the unthreaded file name and appends `-threads` itself under shared memory. */
export const bbWasmPath = (): string => assets.assetUrl(bbWasm).replace(/-threads\.wasm$/, '.wasm')

// bb.js 6.0.0 CRS loaders take no base URL and fetch Aztec's CDN. Keep these external
// and matched to its native URLs/ranges; build/loaders.test.ts observes real loaders.
const crsFile = (name: string, request: { range: string } | { bytes: number }) =>
  assets.external(`https://crs.aztec-cdn.foundation/${name}`, {
    fallback: [`https://crs.aztec-labs.com/${name}`],
    ...request,
  })

export const crs = [
  crsFile('g1_compressed.dat', { range: `bytes=0-${SRS_POINTS * G1_POINT_BYTES - 1}` }),
  crsFile('g2.dat', { bytes: G2_BYTES }),
] as const

export const proofAssets = [acvm, abi, bbWasm, ...crs] as const
