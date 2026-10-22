import type { BrowserContext, Page } from '@playwright/test'
import { clickFound, drivePopup } from './popup.ts'
import { restoreSession, type Stored } from './session.ts'

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

/** The visible, enabled consent control; X serves more than one consent page. */
const FIND_CONSENT = `[...document.querySelectorAll("[data-testid='OAuth_Consent_Button'],button,[role=button],input[type=submit],a")].find(e =>
  (e.getAttribute('data-testid') === 'OAuth_Consent_Button' || /^(authorize app)$/i.test((e.innerText || e.value || '').trim())) &&
  !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0)`

const onX = (url: URL) =>
  url.hostname === 'x.com' || url.hostname === 'twitter.com' || url.hostname.endsWith('.x.com')

/**
 * Approve the OAuth app on X in `popup`, signed in by the saved session, until
 * X returns it to Bridge's callback. A port of libid-server-rs' ceremony-tests/src/browser/x.rs
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
          'X asked to sign in: the saved session has expired. Renew it with `ceremony export x` (libid-server-rs, branch feat/live-ceremony-tests).',
        )
      } else if (url.pathname.startsWith('/i/oauth2/authorize')) {
        challengedAt = undefined
        await popup.evaluate(ACCEPT_COOKIES).catch(() => {})
        if (Date.now() - consentedAt > 10_000 && (await clickFound(popup, FIND_CONSENT)))
          consentedAt = Date.now()
      }
    },
  })
}
