// The live tests' settings, under the names libid-server-rs' ceremony-tests
// reads from the same .env.test. An empty value counts as unset.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import type { PlatformId } from '@libid/ceremony'

/** Each platform's variables; `A|B` is either. The type keeps every platform listed. */
export const PLATFORM_VARIABLES: Record<PlatformId, string[]> = {
  github: ['GH_TEST_ALICE_USERNAME', 'GH_TEST_ALICE_PASSWORD', 'GH_TEST_ALICE_TOTP_SECRET'],
  x: ['X_TEST_ALICE_USERNAME', 'X_TEST_ALICE_COOKIES|X_TEST_ALICE_COOKIES_FILE'],
  google: ['GOOGLE_TEST_ALICE_EMAIL', 'GOOGLE_TEST_ALICE_COOKIES|GOOGLE_TEST_ALICE_COOKIES_FILE'],
}
const PLATFORMS = Object.keys(PLATFORM_VARIABLES) as PlatformId[]

export const env = (name: string) => process.env[name] || undefined

const invoked = () => process.env.INIT_CWD ?? process.cwd()
/** The file LIBID_TEST_ENV_FILE names, relative to where pnpm was invoked. */
const envFile = () => env('LIBID_TEST_ENV_FILE') && resolve(invoked(), env('LIBID_TEST_ENV_FILE')!)

/** Read the env file, if one is named, into the environment; exported values win. */
export function loadEnvFile() {
  const file = envFile()
  if (!file) return
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8'))))
    process.env[name] ??= value
}

/** A path setting: relative to the env file, else to where pnpm was invoked. */
export const settingPath = (path: string) => {
  const file = envFile()
  return resolve(file ? dirname(file) : invoked(), path)
}

export const requireLive = () => /^(1|true)$/i.test(env('LIBID_REQUIRE_LIVE') ?? '')

/** LIBID_LIVE_PLATFORMS, comma-separated, or every platform when it is unset. */
export function livePlatforms(): PlatformId[] {
  const listed = process.env.LIBID_LIVE_PLATFORMS
  if (listed === undefined) return PLATFORMS
  const names = listed
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const unknown = names.filter((name) => !PLATFORMS.includes(name as PlatformId))
  if (unknown.length)
    throw new Error(`LIBID_LIVE_PLATFORMS names ${unknown.join(', ')}; use ${PLATFORMS.join(', ')}`)
  if (!names.length && requireLive())
    throw new Error('LIBID_REQUIRE_LIVE is set but LIBID_LIVE_PLATFORMS selects no platform')
  return names as PlatformId[]
}

/** The variables `platform` lacks. */
export const missing = (platform: PlatformId) =>
  PLATFORM_VARIABLES[platform]
    .filter((names) => !names.split('|').some(env))
    .map((names) => names.replace('|', ' or '))

/** The selected platforms whose tests run: those with every variable set. */
export const runnablePlatforms = () => livePlatforms().filter((p) => !missing(p).length)

/** Under LIBID_REQUIRE_LIVE, fail once, naming every variable a selected platform lacks. */
export function checkSettings() {
  const absent = livePlatforms().flatMap((p) =>
    missing(p).length ? [`${p}: ${missing(p).join(', ')}`] : [],
  )
  if (requireLive() && absent.length)
    throw new Error(
      `Missing live test settings (${absent.join('; ')}). Put them in the file LIBID_TEST_ENV_FILE names, or export them.`,
    )
}
