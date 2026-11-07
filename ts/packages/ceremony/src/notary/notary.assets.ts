import * as assets from '../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.6.0/tlsn-wasm-0.6.0.tar.gz',
  'tlsn/v0.6.0',
  'sha256:43efade011298d99d4852c8f74673586b59f0f3dd45f38bf1fb9fa19b55429e0',
)

export const tlsnModule = release.member('tlsn_wasm.js', {
  ...assets.headers.immutable,
  ...assets.headers.javascript,
})

export const tlsnWasm = release.member('tlsn_wasm_bg.wasm', {
  ...assets.headers.immutable,
  ...assets.headers.wasm,
})

const tlsnSpawn = release.member('snippets/web-spawn-*/js/spawn.js', {
  ...assets.headers.immutable,
  ...assets.headers.executionWorker,
})

export const notaryAssets = [tlsnModule, tlsnWasm, tlsnSpawn] as const
