import * as assets from '../../assets.js'

const release = assets.archive(
  'https://github.com/libid-org/notary/releases/download/v0.3.0-rc.2/tlsn-wasm-0.3.0-rc.2.tar.gz',
  // Worker policy changed; retain the old immutable responses for open documents.
  'tlsn/v0.3.0-rc.2-loopback',
)
export const tlsnModule = release.member('tlsn_wasm.js', {
  ...assets.headers.immutable,
  ...assets.headers.javascript,
})
export const tlsnWasm = release.member('tlsn_wasm_bg.wasm', {
  ...assets.headers.immutable,
  ...assets.headers.wasm,
})
export const tlsnSpawn = release.member('snippets/web-spawn-*/js/spawn.js', {
  ...assets.headers.immutable,
  ...assets.headers.executionWorker,
})
export const notaryAssets = [tlsnModule, tlsnWasm, tlsnSpawn] as const
