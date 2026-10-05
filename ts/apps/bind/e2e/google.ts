import type { Page } from '@playwright/test'
import { clickMarked, drivePopup } from './popup.ts'
import { savedSession } from './session.ts'

/**
 * The saved Google session, from GOOGLE_TEST_ALICE_COOKIES or
 * GOOGLE_TEST_ALICE_COOKIES_FILE. Renew it with `cargo run --bin ceremony --
 * export google` in libid-server-rs' ceremony-tests: Google refuses a sign-in
 * in an automated browser, but honours a session made elsewhere.
 */
export const googleSession = () =>
  savedSession('GOOGLE_TEST_ALICE', ['SID', '__Secure-1PSID', '__Secure-3PSID'])

/** Pages that no automation gets past: the session or the OAuth client needs a person. */
const REFUSED: [string, string][] = [
  ['this browser or app may not be secure', 'Google refused this browser'],
  ["verify it's you", 'Google asks to verify the account interactively'],
  ["verify you're human", 'Google asks to verify the account interactively'],
  ['redirect_uri_mismatch', 'Google rejected the redirect URI of the OAuth client'],
  ['access blocked', 'Google blocked the OAuth client'],
  ['has not completed the google verification process', 'Google blocked the OAuth client'],
  ['invalid_client', 'Google does not know the OAuth client'],
  ['unauthorized_client', 'Google refused the OAuth client'],
  ['unsupported_response_type', 'Google refused the id_token response type'],
]

const LOGIN_VISIBLE = `[...document.querySelectorAll('input[type=password],input[type=email],input[name=identifier]')]
  .some(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')`

/** The account row for `email`, else a Continue or Allow button, marked for a real click. */
const markNext = (email: string) => `(() => {
  document.querySelectorAll('[data-libid-click]').forEach(e => e.removeAttribute('data-libid-click'));
  const usable = e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const account = [...document.querySelectorAll('[data-identifier]')].find(e => usable(e) && e.getAttribute('data-identifier').toLowerCase() === ${JSON.stringify(email.toLowerCase())});
  const consent = [...document.querySelectorAll('button,[role=button],input[type=submit]')].find(e => usable(e) && /^(continue|allow)$/i.test((e.innerText || e.value || '').trim()));
  const next = account || consent;
  if (!next) return false;
  next.setAttribute('data-libid-click', '1');
  return true;
})()`

/**
 * Choose the account and consent on Google in `popup`, signed in by the saved
 * session, until it leaves Google. A port of libid-server-rs'
 * ceremony-tests/src/browser/google.rs without its sign-in: a login page means
 * the saved session has expired.
 */
export async function authorizeOnGoogle(popup: Page, email: string) {
  let clickedAt = 0
  await drivePopup(popup, {
    name: 'Google',
    onHost: (url) => url.hostname === 'accounts.google.com',
    step: async (url, body) => {
      const text = body.replaceAll('’', "'")
      const refused = REFUSED.find(([marker]) => text.includes(marker))
      if (refused) throw new Error(`${refused[1]} (${url.pathname})`)
      if (url.pathname.includes('/challenge/'))
        throw new Error(`Google asks to verify the account interactively (${url.pathname})`)
      if (await popup.evaluate(LOGIN_VISIBLE).catch(() => false))
        throw new Error(
          'Google asked to sign in: the saved session has expired. Renew it with `ceremony export google`.',
        )
      if (Date.now() - clickedAt > 3_000 && (await clickMarked(popup, markNext(email))))
        clickedAt = Date.now()
    },
  })
}
