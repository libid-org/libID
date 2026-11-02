import * as assets from '../assets/index.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.5.0/tlsn-wasm-0.5.0.tar.gz',
  'tlsn/v0.5.0',
  'sha256:bcbd175ca14165d3cc5ad0400b93c814e3e31eaec60e0a0d5db2a990a17869c0',
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
