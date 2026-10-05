import type { BrowserContext, Page } from '@playwright/test'
import { clickMarked, drivePopup } from './popup.ts'
import { restoreSession, type Stored, savedSession } from './session.ts'

/**
 * The saved X session, from X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE.
 * Renew it with `cargo run --bin ceremony -- export x` in libid-server-rs'
 * ceremony-tests.
 */
export const xSession = () => savedSession('X_TEST_ALICE', ['auth_token'])

/** Put the saved session on both hosts X answers on, as the Rust suite does. */
export const restoreXSession = (context: BrowserContext, cookies: Stored[]) =>
  restoreSession(context, cookies, (domain) => [domain, domain.replace('x.com', 'twitter.com')])

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
  document.querySelectorAll('[data-libid-click]').forEach(e => e.removeAttribute('data-libid-click'));
  const button = [...document.querySelectorAll("[data-testid='OAuth_Consent_Button'],button,[role=button],input[type=submit],a")].find(e =>
    (e.getAttribute('data-testid') === 'OAuth_Consent_Button' || /^(authorize app)$/i.test((e.innerText || e.value || '').trim())) &&
    !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0);
  if (button) { button.setAttribute('data-libid-click', '1'); return true; }
  return false;
})()`

const onX = (url: URL) =>
  url.hostname === 'x.com' || url.hostname === 'twitter.com' || url.hostname.endsWith('.x.com')

/**
 * Approve the OAuth app on X in `popup`, signed in by the saved session, until
 * it leaves X. A port of libid-server-rs' ceremony-tests/src/browser/x.rs
 * without its interactive sign-in: a login page means the saved session has
 * expired.
 */
export async function authorizeOnX(popup: Page) {
  let consentedAt = 0
  let challengedAt: number | undefined
  await drivePopup(popup, {
    name: 'X',
    onHost: onX,
    step: async (url, text) => {
      if (CHALLENGE.some((marker) => text.includes(marker))) {
        challengedAt ??= Date.now()
        if (Date.now() - challengedAt > 90_000)
          throw new Error('X security verification did not clear within 90 s')
      } else if (url.pathname.startsWith('/i/flow/login') || url.pathname === '/login') {
        throw new Error(
          'X asked to sign in: the saved session has expired. Renew it with `ceremony export x`.',
        )
      } else if (url.pathname.startsWith('/i/oauth2/authorize')) {
        challengedAt = undefined
        await popup.evaluate(ACCEPT_COOKIES).catch(() => {})
        if (Date.now() - consentedAt > 10_000 && (await clickMarked(popup, MARK_CONSENT)))
          consentedAt = Date.now()
      }
    },
  })
}
