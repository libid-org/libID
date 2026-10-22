// The settings the live tests read: every variable, its section and whether
// the section needs it, in VARIABLES; one typed reader per section. The names
// are those of libid-server-rs' ceremony-tests (src/settings.rs), which reads
// the same .env.test. An empty value is an absent one.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import type { PlatformId } from '@libid/ceremony'

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

/** The value of a name, if it has one. */
export type Lookup = (name: string) => string | undefined

const environment: Lookup = (name) => process.env[name] || undefined

/** Where pnpm was invoked: what a relative path in a setting is relative to. */
const invoked = (get: Lookup) => get('INIT_CWD') ?? process.cwd()

/** The settings file LIBID_TEST_ENV_FILE names, relative to where pnpm was invoked. */
export function envFile(get: Lookup = environment): string | undefined {
  const file = get('LIBID_TEST_ENV_FILE')
  return file && resolve(invoked(get), file)
}

/**
 * Read the settings file into the environment: a value already set wins, and
 * an empty one counts as absent. Returns the file's keys.
 */
export function loadEnvFile(file: string): string[] {
  const values = parseEnv(readFileSync(file, 'utf8'))
  for (const [name, value] of Object.entries(values))
    if (environment(name) === undefined) process.env[name] = value
  return Object.keys(values)
}

export interface Tooling {
  /** LIBID_LIVE_PLATFORMS, trimmed and checked, or every supported platform. */
  platforms: readonly PlatformId[]
  /** A missing setting fails the run instead of skipping its test. */
  requireLive: boolean
  proxy?: string
  /** Show the browser. */
  headed: boolean
  /** A CI run: no traces or videos, the stack's output kept off the job log. */
  ci: boolean
}

/** A switch: on for `1` or `true`, in any case; off for anything else. */
const flag = (get: Lookup, name: string) => /^(1|true)$/i.test(get(name) ?? '')

export function tooling(get: Lookup = environment): Tooling {
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
    proxy: get('LIBID_TEST_PROXY'),
    headed: flag(get, 'HEADED'),
    ci: flag(get, 'CI'),
  }
}

/** Whether this run proves `platform`; one left out is skipped, and reported as skipped. */
export const isLive = (platform: PlatformId) => tooling().platforms.includes(platform)

/** The required variables of `section` that `get` finds absent; `A (or B)` where B stands in. */
export function missing(section: Section, get: Lookup = environment): string[] {
  return VARIABLES.filter(([name, of, need]) => of === section && need === 'required' && !get(name))
    .map(([name]) => {
      const standIn = VARIABLES.find(
        ([, , need]) => typeof need === 'object' && need.insteadOf === name,
      )?.[0]
      if (!standIn) return name
      return get(standIn) ? undefined : `${name} (or ${standIn})`
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
    username: get('GH_TEST_ALICE_USERNAME')!,
    password: get('GH_TEST_ALICE_PASSWORD')!,
    totpSecret: get('GH_TEST_ALICE_TOTP_SECRET')!,
  }))

/** The GitHub account's secrets that are set, for the failure-output scan. */
export const githubSecrets = (get: Lookup = environment) =>
  [get('GH_TEST_ALICE_PASSWORD'), get('GH_TEST_ALICE_TOTP_SECRET')].filter(
    (secret): secret is string => secret !== undefined,
  )

export const xAccount = (get: Lookup = environment) =>
  read('x-account', get, () => ({ username: get('X_TEST_ALICE_USERNAME')! }))

export const googleAccount = (get: Lookup = environment) =>
  read('google-account', get, () => ({ email: get('GOOGLE_TEST_ALICE_EMAIL')! }))

/** A saved session: base64 of the JSON cookie list, or a path to that JSON. */
export type SavedSession = { encoded: string } | { path: string }

function savedSession(prefix: string, get: Lookup): SavedSession | undefined {
  const encoded = get(`${prefix}_COOKIES`)
  if (encoded) return { encoded }
  const file = get(`${prefix}_COOKIES_FILE`)
  if (!file) return undefined
  // A relative path is the settings file's neighbour, else relative to where pnpm was invoked.
  const settingsFile = envFile(get)
  return { path: resolve(settingsFile ? dirname(settingsFile) : invoked(get), file) }
}

export const xSession = (get: Lookup = environment) => savedSession('X_TEST_ALICE', get)

export const googleSession = (get: Lookup = environment) => savedSession('GOOGLE_TEST_ALICE', get)
