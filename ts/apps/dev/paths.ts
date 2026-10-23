// Where a path setting points, for the live tests' settings and services.ts
// alike: a relative path is the settings file's neighbour when
// LIBID_TEST_ENV_FILE names one, else relative to where pnpm was invoked.
import { dirname, resolve } from 'node:path'

/** The value of a name as set, empty included; undefined when unset. */
export type Lookup = (name: string) => string | undefined

/** A value, an empty one counting as absent. */
export const nonEmpty = (get: Lookup, name: string) => get(name) || undefined

/** Where pnpm was invoked. */
const invoked = (get: Lookup) => nonEmpty(get, 'INIT_CWD') ?? process.cwd()

/** The settings file LIBID_TEST_ENV_FILE names, relative to where pnpm was invoked. */
export function envFile(get: Lookup): string | undefined {
  const file = nonEmpty(get, 'LIBID_TEST_ENV_FILE')
  return file && resolve(invoked(get), file)
}

/** The path a setting names, resolved; undefined when it is unset or empty. */
export function settingPath(get: Lookup, path: string | undefined): string | undefined {
  if (!path) return undefined
  const settingsFile = envFile(get)
  return resolve(settingsFile ? dirname(settingsFile) : invoked(get), path)
}
