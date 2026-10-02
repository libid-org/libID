import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'

/** One cookie as libid-server-rs' `ceremony export x` saves it. */
interface Stored {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean | null
  http_only?: boolean
  same_site?: string | null
  expires?: number
}

/**
 * The saved X session, from X_TEST_ALICE_COOKIES (base64 JSON) or
 * X_TEST_ALICE_COOKIES_FILE (a path, relative to the env file's directory);
 * undefined when neither is set. Renew it with `cargo run --bin ceremony --
 * export x` in libid-server-rs' ceremony-tests.
 */
export function xSession(): Stored[] | undefined {
  const encoded = process.env.X_TEST_ALICE_COOKIES
  const file = process.env.X_TEST_ALICE_COOKIES_FILE
  let json: string
  if (encoded) json = Buffer.from(encoded.trim(), 'base64').toString('utf8')
  else if (file)
    json = readFileSync(
      isAbsolute(file) ? file : join(process.env.LIBID_TEST_ENV_DIR ?? '.', file),
      'utf8',
    )
  else if (process.env.LIBID_REQUIRE_LIVE)
    throw new Error('LIBID_REQUIRE_LIVE is set but no saved X session is')
  else return undefined
  const parsed = JSON.parse(json) as Stored[] | { cookies: Stored[] }
  const cookies = Array.isArray(parsed) ? parsed : parsed.cookies
  if (!cookies.some((cookie) => cookie.name === 'auth_token'))
    throw new Error('The saved X session has no auth_token cookie')
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

/** Put the saved session on both hosts X answers on, as the Rust suite does. */
export async function restoreXSession(context: BrowserContext, cookies: Stored[]) {
  await context.addCookies(
    ['x.com', 'twitter.com'].flatMap((host) =>
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain.replace('x.com', host),
        path: cookie.path || '/',
        secure: cookie.secure ?? true,
        httpOnly: cookie.http_only ?? false,
        sameSite: sameSite(cookie.same_site),
        expires: cookie.expires && cookie.expires > 0 ? cookie.expires : -1,
      })),
    ),
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CHALLENGE = [
  'performing security verification',
  'verify you are human',
  'verifies you are not a bot',
  'checking your browser',
]

/** X's cookie banner accepted, if it shows. */
const ACCEPT_COOKIES = `(() => {
  const span = [...document.querySelectorAll('span')].find(s => s.textContent.includes('Accept all cookies'));
  const button = span && span.closest('button,[role=button],div[role=button]');
  if (button) { button.click(); return true; }
  return false;
})()`

/** The visible, enabled consent control marked for a real click; X serves more than one consent page. */
const MARK_CONSENT = `(() => {
  document.querySelectorAll('[data-libid-consent]').forEach(e => e.removeAttribute('data-libid-consent'));
  const button = [...document.querySelectorAll("[data-testid='OAuth_Consent_Button'],button,[role=button],input[type=submit],a")].find(e =>
    (e.getAttribute('data-testid') === 'OAuth_Consent_Button' || /^(authorize app)$/i.test((e.innerText || e.value || '').trim())) &&
    !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0);
  if (button) { button.setAttribute('data-libid-consent', '1'); return true; }
  return false;
})()`

const onX = (url: URL | null) =>
  url?.hostname === 'x.com' || url?.hostname === 'twitter.com' || url?.hostname?.endsWith('.x.com')

/**
 * Approve the OAuth app on X in `popup`, signed in by the saved session, until
 * it leaves X. A port of libid-server-rs' ceremony-tests/src/browser/x.rs
 * without its interactive sign-in: a login page means the saved session has
 * expired.
 */
export async function authorizeOnX(popup: Page, budgetMs = 180_000) {
  const started = Date.now()
  let visited = false
  let consentedAt: number | undefined
  let challengedAt: number | undefined
  while (Date.now() - started < budgetMs) {
    if (popup.isClosed()) return
    const url = URL.parse(popup.url())
    if (!onX(url)) {
      if (visited) return
      await sleep(250)
      continue
    }
    visited = true
    const text = (
      (await popup
        .locator('body')
        .textContent()
        .catch(() => '')) ?? ''
    ).toLowerCase()
    if (CHALLENGE.some((marker) => text.includes(marker))) {
      challengedAt ??= Date.now()
      if (Date.now() - challengedAt > 90_000)
        throw new Error('X security verification did not clear within 90 s')
    } else if (url!.pathname.startsWith('/i/flow/login') || url!.pathname === '/login') {
      throw new Error(
        'X asked to sign in: the saved session has expired. Renew it with `ceremony export x`.',
      )
    } else if (url!.pathname.startsWith('/i/oauth2/authorize')) {
      challengedAt = undefined
      await popup.evaluate(ACCEPT_COOKIES).catch(() => {})
      if (
        (consentedAt === undefined || Date.now() - consentedAt > 10_000) &&
        (await popup.evaluate(MARK_CONSENT).catch(() => false))
      ) {
        await popup
          .locator('[data-libid-consent="1"]')
          .click({ timeout: 5_000 })
          .catch(() => {})
        consentedAt = Date.now()
      }
    }
    await sleep(250)
  }
  throw new Error(`No X authorization in ${budgetMs / 1000} s; stopped on ${popup.url()}`)
}
