import * as assets from '../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.7.0/tlsn-wasm-0.7.0.tar.gz',
  'tlsn/v0.7.0',
  'sha256:4fd772f68b8648855d8c361f836300f9a8f35aac081027d2e04f38e20b74e473',
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
