// Saved platform sessions: decoded, kept to the platform's hosts, restored.
import { readFileSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import { env, settingPath } from './settings.ts'

/** One cookie as libid-server-rs' `ceremony export` or Playwright saves it; both key casings occur. */
interface Stored {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean | null
  http_only?: boolean
  httpOnly?: boolean
  same_site?: string | null
  sameSite?: string | null
  expires?: number
  expirationDate?: number
  partition_key?: string | { topLevelSite?: string } | null
  partitionKey?: string | { topLevelSite?: string } | null
}

const hostOf = (cookie: Stored) => cookie.domain.replace(/^\./, '')
export const onX = (host: string) => host === 'x.com' || host.endsWith('.x.com')
const onGoogle = (host: string) => host === 'google.com' || host.endsWith('.google.com')

/**
 * The platform's cookies in `<prefix>_COOKIES` (base64 JSON) or `<prefix>_COOKIES_FILE`:
 * a list, or one under `cookies`, one of them `signedIn` (the Rust suite's signed_in).
 */
function saved(
  prefix: string,
  keep: (host: string) => boolean,
  signedIn: (cookie: Stored) => boolean,
  needs: string,
): Stored[] | undefined {
  const encoded = env(`${prefix}_COOKIES`)
  const file = env(`${prefix}_COOKIES_FILE`)
  if (!encoded && !file) return undefined
  let cookies: unknown
  try {
    const parsed = JSON.parse(
      encoded
        ? Buffer.from(encoded.trim(), 'base64').toString('utf8')
        : readFileSync(settingPath(file!), 'utf8'),
    )
    cookies = Array.isArray(parsed) ? parsed : parsed?.cookies
  } catch {
    // The parser's message would quote the value.
  }
  if (!Array.isArray(cookies))
    throw new Error(`The saved ${prefix} session is not a JSON cookie list or { cookies }`)
  const kept = (cookies as Stored[]).filter((cookie) => keep(hostOf(cookie)))
  if (!kept.some(signedIn)) throw new Error(`The saved ${prefix} session has no ${needs}`)
  return kept
}

export const xSession = () =>
  saved('X_TEST_ALICE', onX, (cookie) => cookie.name === 'auth_token', 'auth_token')

export const googleSession = () =>
  saved(
    'GOOGLE_TEST_ALICE',
    onGoogle,
    (cookie) =>
      cookie.domain.endsWith('accounts.google.com') &&
      (cookie.name === 'LSID' || cookie.name === '__Host-1PLSID'),
    'LSID or __Host-1PLSID on accounts.google.com',
  )

const SAME_SITE: Record<string, 'Strict' | 'Lax' | 'None'> = {
  strict: 'Strict',
  lax: 'Lax',
  none: 'None',
  no_restriction: 'None',
}

type CookieParam = Parameters<BrowserContext['addCookies']>[0][number]

/** A cookie as addCookies takes it; a dotless domain stays host-only. */
export function cookieParam(cookie: Stored): CookieParam {
  const sameSite = SAME_SITE[(cookie.same_site ?? cookie.sameSite ?? '').toLowerCase()]
  const expires = cookie.expires ?? cookie.expirationDate ?? 0
  // The Rust export writes CDP's object; Playwright takes its top-level site.
  const key = cookie.partition_key ?? cookie.partitionKey
  const partitionKey = typeof key === 'string' ? key : key?.topLevelSite
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: cookie.secure ?? true,
    httpOnly: cookie.http_only ?? cookie.httpOnly ?? false,
    expires: expires > 0 ? expires : -1,
    ...(sameSite && { sameSite }),
    ...(partitionKey && { partitionKey }),
  }
}

export const restoreSession = (context: BrowserContext, cookies: Stored[]) =>
  context.addCookies(cookies.map(cookieParam))
