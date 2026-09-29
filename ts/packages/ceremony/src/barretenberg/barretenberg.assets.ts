import * as assets from '../assets/index.js'
import {
  G1_POINT_BYTES,
  G2_BYTES,
  GRUMPKIN_POINT_BYTES,
  GRUMPKIN_SRS_POINTS,
  SRS_POINTS,
} from './parameters.js'

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
  crsFile('g1_compressed.dat', { range: `bytes=0-${SRS_POINTS * G1_POINT_BYTES - 1}` }),
  crsFile('g2.dat', { bytes: G2_BYTES }),
  crsFile('grumpkin_g1_v2.dat', {
    range: `bytes=0-${GRUMPKIN_SRS_POINTS * GRUMPKIN_POINT_BYTES - 1}`,
  }),
] as const

export const proofAssets = [acvm, abi, bbWasm, ...crs] as const
