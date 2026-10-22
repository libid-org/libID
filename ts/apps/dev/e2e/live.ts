import type { PlatformId } from '@libid/ceremony'

/**
 * Whether this run proves `platform`: LIBID_LIVE_PLATFORMS, comma-separated,
 * or all three. A platform left out is skipped on purpose, and reported as skipped.
 */
export function isLive(platform: PlatformId): boolean {
  const listed = process.env.LIBID_LIVE_PLATFORMS?.split(',').map((name) => name.trim())
  return (listed ?? ['github', 'x', 'google']).includes(platform)
}

/**
 * A test secret from the environment, or undefined, which skips the test
 * locally. With LIBID_REQUIRE_LIVE set, as CI sets it, a missing secret fails
 * the run instead.
 */
export function liveSecret(name: string): string | undefined {
  const value = process.env[name]
  if (value) return value
  if (process.env.LIBID_REQUIRE_LIVE)
    throw new Error(`LIBID_REQUIRE_LIVE is set but ${name} is not`)
  return undefined
}
