import { readFileSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import * as settings from './settings.ts'
import type { SavedSession } from './settings.ts'

/**
 * One cookie as libid-server-rs' `ceremony export` saves it (ceremony-tests
 * src/browser/cookies.rs): snake_case or camelCase keys, `expirationDate` for
 * `expires`, and a partition key as CDP's object or its top-level site alone.
 */
export interface Stored {
  name: string
  value: string
  /** With a leading dot for a domain cookie; the host alone for a host-only one. */
  domain: string
  path?: string
  secure?: boolean | null
  http_only?: boolean
  httpOnly?: boolean
  same_site?: string | null
  sameSite?: string | null
  expires?: number
  expirationDate?: number
  partition_key?: PartitionKey | string | null
  partitionKey?: PartitionKey | string | null
}

interface PartitionKey {
  topLevelSite?: string
  top_level_site?: string
  hasCrossSiteAncestor?: boolean
}

/** The JSON text of a saved session setting. */
export const exportText = (saved: SavedSession) =>
  'encoded' in saved
    ? Buffer.from(saved.encoded.trim(), 'base64').toString('utf8')
    : readFileSync(saved.path, 'utf8')

/** A cookie's host, without the leading dot of a domain cookie. */
const hostOf = (cookie: Stored) => cookie.domain.replace(/^\./, '')

/** A cookie's expiry in Unix seconds; 0 for a session cookie. */
const expiresOf = (cookie: Stored) => cookie.expires ?? cookie.expirationDate ?? 0

/** Hosts a platform's session cookies live on, as the Rust suite's x_host and google_host admit. */
export const onX = (host: string) => host === 'x.com' || host.endsWith('.x.com')
export const onGoogle = (host: string) => host === 'google.com' || host.endsWith('.google.com')

/** Capitalised spellings an export may use, as cookies.rs' serde aliases accept. */
const CAPITALISED = {
  Name: 'name',
  Value: 'value',
  Domain: 'domain',
  Path: 'path',
  Secure: 'secure',
}

/** One export entry as a cookie: an object with string name, value and domain; else undefined. */
function storedOf(entry: unknown): Stored | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
  const cookie: Record<string, unknown> = { ...entry }
  for (const [spelled, name] of Object.entries(CAPITALISED))
    if (spelled in cookie && !(name in cookie)) cookie[name] = cookie[spelled]
  const { name, value, domain } = cookie
  return typeof name === 'string' && typeof value === 'string' && typeof domain === 'string'
    ? (cookie as unknown as Stored)
    : undefined
}

/**
 * The cookies of an export for the hosts `keep` admits, as the Rust suite's
 * cookies::parse reads them: a list, or one under `cookies`, of entries with
 * string name, value and domain; an expired cookie is left out. Undefined
 * when the text is no such export.
 */
export function parseExport(
  json: string,
  keep: (host: string) => boolean,
  now = Date.now() / 1000,
): Stored[] | undefined {
  let cookies: unknown
  try {
    const parsed = JSON.parse(json) as unknown
    cookies = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown } | null)?.cookies
  } catch {
    // The parser's message would quote the value.
  }
  if (!Array.isArray(cookies)) return undefined
  const read = cookies.map(storedOf)
  if (read.some((cookie) => cookie === undefined)) return undefined
  return (read as Stored[]).filter((cookie) => {
    const expires = expiresOf(cookie)
    return keep(hostOf(cookie)) && (expires <= 0 || expires >= now)
  })
}

/**
 * The platform's cookies of a saved session setting, or undefined when it is
 * not set. `required` names cookies of which at least one must be present for
 * the export to hold a session.
 */
function cookiesOf(
  saved: SavedSession | undefined,
  label: string,
  keep: (host: string) => boolean,
  required: string[],
): Stored[] | undefined {
  if (!saved) return undefined
  const cookies = parseExport(exportText(saved), keep)
  if (!cookies)
    throw new Error(`The saved ${label} session is not a JSON cookie list or { cookies }`)
  if (!cookies.some((cookie) => required.includes(cookie.name)))
    throw new Error(`The saved ${label} session has none of ${required.join(', ')} unexpired`)
  return cookies
}

/**
 * The saved X session, from X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE.
 * Renew it with `cargo run --bin ceremony -- export x` in libid-server-rs'
 * ceremony-tests, which lives on its feat/live-ceremony-tests branch
 * (libid-server-rs PR #12).
 */
export const xSession = () => cookiesOf(settings.xSession(), 'X_TEST_ALICE', onX, ['auth_token'])

/**
 * The saved Google session, from GOOGLE_TEST_ALICE_COOKIES or
 * GOOGLE_TEST_ALICE_COOKIES_FILE. Renew it with `cargo run --bin ceremony --
 * export google` in libid-server-rs' ceremony-tests, which lives on its
 * feat/live-ceremony-tests branch (libid-server-rs PR #12): Google refuses a
 * sign-in in an automated browser, but honours a session made elsewhere.
 */
export const googleSession = () =>
  cookiesOf(settings.googleSession(), 'GOOGLE_TEST_ALICE', onGoogle, [
    'SID',
    '__Secure-1PSID',
    '__Secure-3PSID',
  ])

const SAME_SITE = new Map<string, 'Strict' | 'Lax' | 'None'>([
  ['strict', 'Strict'],
  ['lax', 'Lax'],
  ['none', 'None'],
  ['no_restriction', 'None'],
])

type CookieParam = Parameters<BrowserContext['addCookies']>[0][number]

/**
 * The cookies to set for a saved session, as the Rust suite sets them: a
 * domain cookie (leading dot) on its domain, a `__Host-` one by `url` alone,
 * another host-only one on its host without a dot, which Chromium keeps
 * host-only with its exact path. `domainsOf`
 * gives the domains each cookie goes on.
 */
export function cookieParams(
  cookies: Stored[],
  domainsOf: (domain: string) => string[] = (domain) => [domain],
): CookieParam[] {
  return cookies.flatMap((cookie) => {
    const expires = expiresOf(cookie)
    const key = cookie.partition_key ?? cookie.partitionKey
    // Playwright takes the partition's top-level site only: an exported
    // hasCrossSiteAncestor is dropped, and Playwright sets it true.
    const partitionKey = typeof key === 'string' ? key : (key?.topLevelSite ?? key?.top_level_site)
    return domainsOf(cookie.domain).map((domain): CookieParam => {
      const path = cookie.path || '/'
      const placed = cookie.name.startsWith('__Host-')
        ? { url: `https://${domain}/` }
        : { domain, path }
      return {
        name: cookie.name,
        value: cookie.value,
        ...placed,
        secure: cookie.secure ?? true,
        httpOnly: cookie.http_only ?? cookie.httpOnly ?? false,
        sameSite: SAME_SITE.get((cookie.same_site ?? cookie.sameSite ?? '').toLowerCase()),
        expires: expires > 0 ? expires : -1,
        ...(partitionKey && { partitionKey }),
      }
    })
  })
}

/** Put saved cookies in the browser context, on their own domain or each of `domainsOf`'s. */
export async function restoreSession(
  context: BrowserContext,
  cookies: Stored[],
  domainsOf?: (domain: string) => string[],
) {
  await context.addCookies(cookieParams(cookies, domainsOf))
}
