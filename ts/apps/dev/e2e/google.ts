import type { Page } from '@playwright/test'
import { clickFound, drivePopup, evaluateWithin } from './popup.ts'
import { onGoogle } from './session.ts'

/** How long the popup may stay on a Google host other than accounts.google.com. */
const ELSEWHERE_GRACE = 5_000

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

/** The account row for `email`, else a Continue or Allow button. */
const findNext = (email: string) => `(() => {
  const usable = e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const account = [...document.querySelectorAll('[data-identifier]')].find(e => usable(e) && e.getAttribute('data-identifier').toLowerCase() === ${JSON.stringify(email.toLowerCase())});
  const consent = [...document.querySelectorAll('button,[role=button],input[type=submit]')].find(e => usable(e) && /^(continue|allow)$/i.test((e.innerText || e.value || '').trim()));
  return account || consent;
})()`

/**
 * Choose the account and consent on Google in `popup`, signed in by the saved
 * session, until Google returns it to Bridge's callback. A port of libid-server-rs'
 * ceremony-tests/src/browser/google.rs without its sign-in: a login page means
 * the saved session has expired.
 */
export async function authorizeOnGoogle(popup: Page, email: string) {
  let clickedAt = 0
  let elsewhereSince: number | undefined
  await drivePopup(popup, {
    name: 'Google',
    onHost: (url) => onGoogle(url.hostname),
    step: async (url, text) => {
      // Another Google host has no handler: fail on one that stays, naming it.
      if (url.hostname !== 'accounts.google.com') {
        elsewhereSince ??= Date.now()
        if (Date.now() - elsewhereSince > ELSEWHERE_GRACE)
          throw new Error(
            `Google left the popup on ${url.hostname}${url.pathname}, which no step drives`,
          )
        return
      }
      elsewhereSince = undefined
      const refused = REFUSED.find(([marker]) => text.includes(marker))
      if (refused) throw new Error(`${refused[1]} (${url.pathname})`)
      if (url.pathname.includes('/challenge/'))
        throw new Error(`Google asks to verify the account interactively (${url.pathname})`)
      if (await evaluateWithin(popup, LOGIN_VISIBLE, false))
        throw new Error(
          'Google asked to sign in: the saved session has expired. Renew it with `ceremony export google` (libid-server-rs, branch feat/live-ceremony-tests).',
        )
      if (Date.now() - clickedAt > 3_000 && (await clickFound(popup, findNext(email))))
        clickedAt = Date.now()
    },
  })
}
