// The settings the live tests read: every variable, its section and whether
// the section needs it, in VARIABLES; one typed reader per section. The names
// are those of libid-server-rs' ceremony-tests (src/settings.rs), which reads
// the same .env.test. An empty value is an absent one.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import type { PlatformId } from '@libid/ceremony'
import { envFile as envFileOf, type Lookup, nonEmpty, settingPath } from '../paths.ts'

/** Whether a section needs a variable; `insteadOf` stands in for that required one. */
export type Need = 'required' | 'optional' | { insteadOf: string }

export type Section =
  | 'github-account'
  | 'x-account'
  | 'x-session'
  | 'google-account'
  | 'google-session'
  | 'tooling'

/** Every variable the live tests read: its name, its section, and its need. */
export const VARIABLES: readonly (readonly [name: string, section: Section, need: Need])[] = [
  ['GH_TEST_ALICE_USERNAME', 'github-account', 'required'],
  ['GH_TEST_ALICE_PASSWORD', 'github-account', 'required'],
  ['GH_TEST_ALICE_TOTP_SECRET', 'github-account', 'required'],
  ['X_TEST_ALICE_USERNAME', 'x-account', 'required'],
  ['X_TEST_ALICE_COOKIES', 'x-session', 'required'],
  ['X_TEST_ALICE_COOKIES_FILE', 'x-session', { insteadOf: 'X_TEST_ALICE_COOKIES' }],
  ['GOOGLE_TEST_ALICE_EMAIL', 'google-account', 'required'],
  ['GOOGLE_TEST_ALICE_COOKIES', 'google-session', 'required'],
  ['GOOGLE_TEST_ALICE_COOKIES_FILE', 'google-session', { insteadOf: 'GOOGLE_TEST_ALICE_COOKIES' }],
  ['LIBID_TEST_ENV_FILE', 'tooling', 'optional'],
  ['LIBID_LIVE_PLATFORMS', 'tooling', 'optional'],
  ['LIBID_REQUIRE_LIVE', 'tooling', 'optional'],
  ['LIBID_TEST_PROXY', 'tooling', 'optional'],
  // Read by services.ts, in the stack's own process.
  ['LIBID_STACK_LOGS', 'tooling', 'optional'],
  ['HEADED', 'tooling', 'optional'],
  // Set by CI services, such as GitHub Actions.
  ['CI', 'tooling', 'optional'],
]

/** The sections each platform's live test reads; the type keeps every platform listed. */
export const PLATFORM_SECTIONS: Record<PlatformId, readonly Section[]> = {
  github: ['github-account'],
  x: ['x-account', 'x-session'],
  google: ['google-account', 'google-session'],
}

const PLATFORMS = Object.keys(PLATFORM_SECTIONS) as PlatformId[]

/** Variables of the shared .env.test that only the Rust suite reads. */
const RUST_SUITE_ONLY = [
  'LIBID_TEST_PUBLIC_ORIGIN',
  'LIBID_TEST_X_REDIRECT_URI',
  'LIBID_TEST_GOOGLE_REDIRECT_URI',
  'X_TEST_ALICE_EMAIL',
  'X_TEST_ALICE_PASSWORD',
  'GOOGLE_TEST_ALICE_PASSWORD',
]

export type { Lookup } from '../paths.ts'

const environment: Lookup = (name) => process.env[name]

/** Exported variables an env file does not override even when set empty. */
const EMPTY_WINS = ['LIBID_LIVE_PLATFORMS']

/**
 * Read the settings file into the environment: an exported value wins; an
 * empty one counts as absent, except for EMPTY_WINS. Returns the file's keys.
 */
export function loadEnvFile(file: string): string[] {
  const values = parseEnv(readFileSync(file, 'utf8'))
  for (const [name, value] of Object.entries(values)) {
    const exported = process.env[name]
    if (exported === undefined || (exported === '' && !EMPTY_WINS.includes(name)))
      process.env[name] = value
  }
  return Object.keys(values)
}

export const envFile = (get: Lookup = environment) => envFileOf(get)

export interface Tooling {
  /** LIBID_LIVE_PLATFORMS, trimmed and checked, or every platform when it is unset. */
  platforms: readonly PlatformId[]
  /** A missing setting fails the run instead of skipping its test. */
  requireLive: boolean
  proxy?: string
  /** LIBID_STACK_LOGS, resolved as a path setting. */
  stackLogs?: string
  /** Show the browser. */
  headed: boolean
  /** A CI run: no traces or videos, the stack's output kept off the job log. */
  ci: boolean
}

/** A switch: on for `1` or `true`, in any case; off for anything else. */
const flag = (get: Lookup, name: string) => /^(1|true)$/i.test(nonEmpty(get, name) ?? '')

export function tooling(get: Lookup = environment): Tooling {
  // Set but empty selects no platform; only an unset variable means all.
  const listed = get('LIBID_LIVE_PLATFORMS')
  const names = listed
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const unknown = names?.filter((name) => !PLATFORMS.includes(name as PlatformId)) ?? []
  if (unknown.length)
    throw new Error(`LIBID_LIVE_PLATFORMS names ${unknown.join(', ')}; use ${PLATFORMS.join(', ')}`)
  return {
    platforms: (names as PlatformId[] | undefined) ?? PLATFORMS,
    requireLive: flag(get, 'LIBID_REQUIRE_LIVE'),
    proxy: nonEmpty(get, 'LIBID_TEST_PROXY'),
    stackLogs: settingPath(get, nonEmpty(get, 'LIBID_STACK_LOGS')),
    headed: flag(get, 'HEADED'),
    ci: flag(get, 'CI'),
  }
}

/** Whether this run proves `platform`; one left out is skipped, and reported as skipped. */
export const isLive = (platform: PlatformId) => tooling().platforms.includes(platform)

/** The required variables of `section` that `get` finds absent; `A (or B)` where B stands in. */
export function missing(section: Section, get: Lookup = environment): string[] {
  return VARIABLES.filter(
    ([name, of, need]) => of === section && need === 'required' && !nonEmpty(get, name),
  )
    .map(([name]) => {
      const standIn = VARIABLES.find(
        ([, , need]) => typeof need === 'object' && need.insteadOf === name,
      )?.[0]
      if (!standIn) return name
      return nonEmpty(get, standIn) ? undefined : `${name} (or ${standIn})`
    })
    .filter((name): name is string => name !== undefined)
}

/**
 * Check every selected platform's sections at once: with LIBID_REQUIRE_LIVE,
 * one error names every absent variable by platform.
 */
export function checkSettings(get: Lookup = environment) {
  const { platforms, requireLive } = tooling(get)
  if (requireLive && !platforms.length)
    throw new Error('LIBID_REQUIRE_LIVE is set but LIBID_LIVE_PLATFORMS selects no platform')
  if (!requireLive) return
  const absent = platforms.flatMap((platform) => {
    const names = PLATFORM_SECTIONS[platform].flatMap((section) => missing(section, get))
    return names.length ? [`${platform} needs ${names.join(', ')}`] : []
  })
  if (absent.length)
    throw new Error(
      `The live tests are missing settings: ${absent.join('; ')}. Put them in the file LIBID_TEST_ENV_FILE names, or export them; in CI they are repository secrets passed to the job (.github/workflows/live-e2e.yml).`,
    )
}

/** Keys of the settings file that look like settings but neither suite reads: likely typos. */
export function unknownKeys(keys: readonly string[]): string[] {
  return keys.filter(
    (key) =>
      (/^[A-Z]+_TEST_ALICE_/.test(key) || key.startsWith('LIBID_')) &&
      !VARIABLES.some(([name]) => name === key) &&
      !RUST_SUITE_ONLY.includes(key),
  )
}

/** The section's values, or undefined when one it requires is absent. */
function read<T>(section: Section, get: Lookup, value: () => T): T | undefined {
  return missing(section, get).length ? undefined : value()
}

export interface GitHubAccount {
  username: string
  password: string
  /** The base32 key of the account's authenticator app. */
  totpSecret: string
}

export const githubAccount = (get: Lookup = environment) =>
  read<GitHubAccount>('github-account', get, () => ({
    username: nonEmpty(get, 'GH_TEST_ALICE_USERNAME')!,
    password: nonEmpty(get, 'GH_TEST_ALICE_PASSWORD')!,
    totpSecret: nonEmpty(get, 'GH_TEST_ALICE_TOTP_SECRET')!,
  }))

/** The variables whose values the failure-output scan looks for. */
export const SCANNED = [
  'GH_TEST_ALICE_PASSWORD',
  'GH_TEST_ALICE_TOTP_SECRET',
  'X_TEST_ALICE_COOKIES',
  'X_TEST_ALICE_COOKIES_FILE',
  'GOOGLE_TEST_ALICE_COOKIES',
  'GOOGLE_TEST_ALICE_COOKIES_FILE',
] as const

export const xAccount = (get: Lookup = environment) =>
  read('x-account', get, () => ({ username: nonEmpty(get, 'X_TEST_ALICE_USERNAME')! }))

export const googleAccount = (get: Lookup = environment) =>
  read('google-account', get, () => ({ email: nonEmpty(get, 'GOOGLE_TEST_ALICE_EMAIL')! }))

/** A saved session: base64 of the JSON cookie list, or a path to that JSON. */
export type SavedSession = { encoded: string } | { path: string }

function savedSession(prefix: string, get: Lookup): SavedSession | undefined {
  const encoded = nonEmpty(get, `${prefix}_COOKIES`)
  if (encoded) return { encoded }
  const file = nonEmpty(get, `${prefix}_COOKIES_FILE`)
  if (!file) return undefined
  return { path: settingPath(get, file)! }
}

export const xSession = (get: Lookup = environment) => savedSession('X_TEST_ALICE', get)

export const googleSession = (get: Lookup = environment) => savedSession('GOOGLE_TEST_ALICE', get)
