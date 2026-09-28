/// @libid/claim — the browser side of a libID handle claim.
///
/// Three flows, one shape each: open the platform's consent screen, prove
/// control of the account, and return a bind-ready proof made out to the
/// holder address. Submitting the claim (one transaction from the holder)
/// and resolving names are `@libid/contracts`' job; this package produces
/// the proof bytes.
///
/// Static assets the host app must stage at its origin (@libid/claim-full
/// bundles them all; `libid-claim-assets <public-dir>` stages them): the
/// tlsn wasm bundle (/tlsn_wasm.js, /tlsn_wasm_bg.wasm, /spawn.js), the
/// compiled circuits (/circuits/x_token.json for X,
/// /circuits/jwt_email.json for Google — both overridable per-call), and
/// the noir wasm (/wasm/acvm_js_bg.wasm, /wasm/noirc_abi_wasm_bg.wasm).
/// The X and Google provers also require cross-origin isolation
/// (COOP same-origin + COEP require-corp).
///
/// Toolchain note: @aztec/bb.js and the @noir-lang packages are pinned to
/// EXACTLY the toolchain that built the libid-org/libID-circuits release
/// (see its manifest.json). Stable bb.js (5.0.x/5.1.x) cannot deserialize
/// the released beta.20 ACIR, and any drift changes the derived vk — the
/// on-chain verifiers are generated from those exact vk bytes. Bumping the
/// pins requires recutting the circuits release and redeploying its
/// verifiers together; @libid/claim-full's build and tests fail on any
/// mismatch (fetch-assets toolchain tie + vk-hash derivation test).

export * from './channel.js'
export { compressPublicKey } from './crypto.js'
export * from './github.js'
export * from './google/circuitInputs.js'
export * from './google/claim.js'
export * from './google/oidc.js'
export * from './oauth.js'
export * from './prover/index.js'
export * from './relay.js'
export * from './wallet.js'
export * from './x/claim.js'
export * from './x/poll-attestation.js'
export * from './x/prover.js'
export * from './x/range-finders.js'
export * from './x/witness-token.js'
