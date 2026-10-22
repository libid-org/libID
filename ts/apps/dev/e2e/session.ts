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

/**
 * The cookies of a saved session setting, or undefined when it is not set.
 * `required` names cookies of which at least one must be present for the
 * export to hold a session.
 */
function cookiesOf(
  saved: SavedSession | undefined,
  label: string,
  required: string[],
): Stored[] | undefined {
  if (!saved) return undefined
  const json = exportText(saved)
  let cookies: Stored[] | undefined
  try {
    const parsed = JSON.parse(json) as Stored[] | { cookies?: Stored[] }
    cookies = Array.isArray(parsed) ? parsed : parsed.cookies
  } catch {
    // The parser's message would quote the value.
  }
  if (!Array.isArray(cookies))
    throw new Error(`The saved ${label} session is not a JSON cookie list or { cookies }`)
  if (!cookies.some((cookie) => required.includes(cookie.name)))
    throw new Error(`The saved ${label} session has none of ${required.join(', ')}`)
  return cookies
}

/**
 * The saved X session, from X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE.
 * Renew it with `cargo run --bin ceremony -- export x` in libid-server-rs'
 * ceremony-tests, which lives on its feat/live-ceremony-tests branch
 * (libid-server-rs PR #12).
 */
export const xSession = () => cookiesOf(settings.xSession(), 'X_TEST_ALICE', ['auth_token'])

/**
 * The saved Google session, from GOOGLE_TEST_ALICE_COOKIES or
 * GOOGLE_TEST_ALICE_COOKIES_FILE. Renew it with `cargo run --bin ceremony --
 * export google` in libid-server-rs' ceremony-tests, which lives on its
 * feat/live-ceremony-tests branch (libid-server-rs PR #12): Google refuses a
 * sign-in in an automated browser, but honours a session made elsewhere.
 */
export const googleSession = () =>
  cookiesOf(settings.googleSession(), 'GOOGLE_TEST_ALICE', [
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
 * domain cookie on its domain, a host-only or `__Host-` one by `url` alone,
 * each in its partition; an expired one is left out. `domainsOf` gives the
 * domains each cookie goes on.
 */
export function cookieParams(
  cookies: Stored[],
  domainsOf: (domain: string) => string[] = (domain) => [domain],
  now = Date.now() / 1000,
): CookieParam[] {
  return cookies.flatMap((cookie) => {
    const expires = cookie.expires ?? cookie.expirationDate ?? 0
    if (expires > 0 && expires < now) return []
    const key = cookie.partition_key ?? cookie.partitionKey
    const partitionKey = typeof key === 'string' ? key : (key?.topLevelSite ?? key?.top_level_site)
    return domainsOf(cookie.domain).map((domain): CookieParam => {
      const path = cookie.path || '/'
      // Playwright takes a url's path up to its last slash.
      const placed = domain.startsWith('.')
        ? { domain, path }
        : { url: `https://${domain}${path.endsWith('/') ? path : `${path}/`}` }
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
