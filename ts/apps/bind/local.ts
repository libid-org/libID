// The local stack's addresses and ports, for the stack, the app and the tests.
// compose.yaml, keeper.toml and bridge-config.toml repeat what they need, and
// stack.ts refuses to start when a copy differs.

/** anvil, published on the host. */
export const RPC_URL = 'http://127.0.0.1:4688'
export const CHAIN_ID = 31337
/** The bind app, served by Vite; Bridge admits this origin. */
export const APP_ORIGIN = 'http://localhost:4695'
export const APP_PORT = 4695
export const BRIDGE = 'http://localhost:4682'
export const NOTARY = 'http://localhost:4687'
/** The indexer's read API. */
export const API = 'http://127.0.0.1:4689'

/** chain-configurations' local-dev.toml at v0.15.0. */
export const REGISTRY = '0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366'
export const GOOGLE_JWT_ROOTS = '0xb7a2ce28e71dbb9c877d2b5a48de33b5f0e6838d'
/**
 * The CeremonyProofVerifier slot each platform's verifier sits in: the
 * `verifierVersion` that quoteBind and bind route on. libid-deploy registers
 * every launch verifier at slot 1 (its LAUNCH_VERIFIER_VERSION). A slot is
 * this chain's governance choice, not the ceremony version a proof reports,
 * though both are 1 at launch.
 */
export const VERIFIER_VERSION = 1

export type Platform = 'github' | 'x' | 'google'

/**
 * The platforms a live run binds: LIBID_LIVE_PLATFORMS, comma-separated, or
 * all three. The stack rotates Google's keys only when Google is among them.
 */
export function livePlatforms(env: Record<string, string | undefined>): Platform[] {
  const listed = env.LIBID_LIVE_PLATFORMS?.split(',').map((name) => name.trim())
  return (listed ?? ['github', 'x', 'google']) as Platform[]
}
