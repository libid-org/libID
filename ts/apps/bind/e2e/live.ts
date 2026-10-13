import { livePlatforms, type Platform } from '../local.ts'

/**
 * Whether this run binds `platform`. A platform left out of
 * LIBID_LIVE_PLATFORMS is skipped on purpose, and reported as skipped.
 */
export const isLive = (platform: Platform) => livePlatforms(process.env).includes(platform)

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
