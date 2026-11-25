import * as assets from '../assets/index.js'
import { G1_POINT_BYTES, G2_BYTES } from './parameters.js'

const wasmHeaders = { ...assets.headers.immutable, ...assets.headers.wasm }

export const acvm = assets.file(
  'npm:@noir-lang/acvm_js/web/acvm_js_bg.wasm',
  'noir/{version}/acvm_js_bg.wasm',
  wasmHeaders,
)

export const abi = assets.file(
  'npm:@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm',
  'noir/{version}/noirc_abi_wasm_bg.wasm',
  wasmHeaders,
)

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

/** The BN254 SRS of a circuit sized `points`: that many compressed G1 points, and G2. */
export const srs = (points: number) =>
  [
    crsFile('g1_compressed.dat', { range: `bytes=0-${points * G1_POINT_BYTES - 1}` }),
    crsFile('g2.dat', { bytes: G2_BYTES }),
  ] as const

/** The proving code every circuit shares; each circuit declares its own SRS. */
export const proofAssets = [acvm, abi, bbWasm] as const
