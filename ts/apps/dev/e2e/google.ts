import type { Page } from '@playwright/test'
import { drivePopup, throttledClick } from './popup.ts'

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

/**
 * Choose the account and consent on Google in `popup`, signed in by the saved
 * session, until Google returns it to Bridge's callback. A port of libid-server-rs'
 * ceremony-tests/src/browser/google.rs without its sign-in: a login page means
 * the saved session has expired.
 */
export async function authorizeOnGoogle(popup: Page, email: string) {
  const click = throttledClick()
  await drivePopup(popup, {
    name: 'Google',
    onHost: (url) => url.hostname === 'accounts.google.com',
    step: async (url, text) => {
      const refused = REFUSED.find(([marker]) => text.includes(marker))
      if (refused) throw new Error(`${refused[1]} (${url.pathname})`)
      if (url.pathname.includes('/challenge/'))
        throw new Error(`Google asks to verify the account interactively (${url.pathname})`)
      const login = popup.locator('input[type=password],input[type=email],input[name=identifier]')
      if (await login.filter({ visible: true }).count())
        throw new Error(
          "Google asked to sign in: the saved session has expired. Renew it by hand through the proxy (README, Google's session).",
        )
      // The account's row, else a Continue or Allow button.
      await click(
        popup
          .locator(`[data-identifier="${email}" i]`)
          .or(popup.getByRole('button', { name: /^(continue|allow)$/i })),
      )
    },
  })
}
