import { type PlatformId, supportedPlatforms } from '@libid/ceremony'

/**
 * The platforms this run proves: LIBID_LIVE_PLATFORMS, comma-separated, or
 * every supported one. An unknown name is an error, and so is an empty
 * selection under LIBID_REQUIRE_LIVE.
 */
function livePlatforms(): readonly PlatformId[] {
  const listed = process.env.LIBID_LIVE_PLATFORMS
  if (listed === undefined) return supportedPlatforms
  const names = listed
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const unknown = names.filter((name) => !supportedPlatforms.includes(name as PlatformId))
  if (unknown.length)
    throw new Error(
      `LIBID_LIVE_PLATFORMS names ${unknown.join(', ')}; use ${supportedPlatforms.join(', ')}`,
    )
  if (!names.length && process.env.LIBID_REQUIRE_LIVE)
    throw new Error('LIBID_REQUIRE_LIVE is set but LIBID_LIVE_PLATFORMS selects no platform')
  return names as PlatformId[]
}

/** Whether this run proves `platform`; one left out is skipped, and reported as skipped. */
export const isLive = (platform: PlatformId) => livePlatforms().includes(platform)

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
