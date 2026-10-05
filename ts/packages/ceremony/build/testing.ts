// Helpers only the build tests import.

import { artifactsDir } from './sources.ts'

/** The built distribution a test reads: `CEREMONY_ARTIFACT_DIR`, or the default output. */
export const builtArtifacts = process.env.CEREMONY_ARTIFACT_DIR ?? artifactsDir

/**
 * The skip reason of a test needing a served image or the native binary (`name` unset), or
 * false. Under CEREMONY_REQUIRE_NATIVE=1 a missing input fails the run instead of skipping.
 */
export function nativeSkip(name: 'CEREMONY_SWS_URL' | 'CEREMONY_SWS_BINARY'): string | false {
  if (process.env[name]) return false
  if (process.env.CEREMONY_REQUIRE_NATIVE === '1')
    throw new Error(`CEREMONY_REQUIRE_NATIVE=1 requires ${name}`)
  return `${name} is unset`
}
