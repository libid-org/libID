import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BrowserContext } from '@playwright/test'
import { liveSecret } from './live.ts'

/** One cookie as libid-server-rs' `ceremony export` saves it; both key casings occur. */
export interface Stored {
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
}

/**
 * A saved platform session, from `<PREFIX>_COOKIES` (base64 JSON) or
 * `<PREFIX>_COOKIES_FILE` (a path, relative to the env file's directory);
 * undefined when neither is set. `required` names cookies of which at least
 * one must be present for the export to hold a session.
 */
export function savedSession(prefix: string, required: string[]): Stored[] | undefined {
  const encoded = process.env[`${prefix}_COOKIES`]
  const file = process.env[`${prefix}_COOKIES_FILE`]
  let json: string
  if (encoded) json = Buffer.from(encoded.trim(), 'base64').toString('utf8')
  else if (file)
    json = readFileSync(
      isAbsolute(file) ? file : join(process.env.LIBID_TEST_ENV_DIR ?? '.', file),
      'utf8',
    )
  else {
    // Neither is set: fails under LIBID_REQUIRE_LIVE, skips otherwise.
    liveSecret(`${prefix}_COOKIES`)
    return undefined
  }
  const parsed = JSON.parse(json) as Stored[] | { cookies: Stored[] }
  const cookies = Array.isArray(parsed) ? parsed : parsed.cookies
  if (!cookies.some((cookie) => required.includes(cookie.name)))
    throw new Error(`The saved ${prefix} session has none of ${required.join(', ')}`)
  return cookies
}

const sameSite = (value: string | null | undefined): 'Strict' | 'Lax' | 'None' | undefined => {
  const lower = value?.toLowerCase()
  return lower === 'strict'
    ? 'Strict'
    : lower === 'lax'
      ? 'Lax'
      : lower === 'none' || lower === 'no_restriction'
        ? 'None'
        : undefined
}

/** Put saved cookies in the browser context, on their own domain or each of `domainsOf`'s. */
export async function restoreSession(
  context: BrowserContext,
  cookies: Stored[],
  domainsOf: (domain: string) => string[] = (domain) => [domain],
) {
  await context.addCookies(
    cookies.flatMap((cookie) =>
      domainsOf(cookie.domain).map((domain) => ({
        name: cookie.name,
        value: cookie.value,
        domain,
        path: cookie.path || '/',
        secure: cookie.secure ?? true,
        httpOnly: cookie.http_only ?? cookie.httpOnly ?? false,
        sameSite: sameSite(cookie.same_site ?? cookie.sameSite),
        expires: cookie.expires && cookie.expires > 0 ? cookie.expires : -1,
      })),
    ),
  )
}
