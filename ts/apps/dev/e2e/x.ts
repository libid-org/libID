import type { Page } from '@playwright/test'
import { drivePopup, throttledClick } from './popup.ts'
import { onX } from './session.ts'

const CHALLENGE = [
  'performing security verification',
  'verify you are human',
  'verifies you are not a bot',
  'checking your browser',
]

/**
 * Approve the OAuth app on X in `popup`, signed in by the saved session, until
 * X returns it to Bridge's callback. A port of libid-server-rs' ceremony-tests/src/browser/x.rs
 * without its interactive sign-in: a login page means the saved session has
 * expired.
 */
export async function authorizeOnX(popup: Page) {
  const click = throttledClick()
  let cookiesAccepted = false
  let challengedAt: number | undefined
  await drivePopup(popup, {
    name: 'X',
    onHost: (url) => onX(url.hostname),
    step: async (url, text) => {
      if (CHALLENGE.some((marker) => text.includes(marker))) {
        challengedAt ??= Date.now()
        if (Date.now() - challengedAt > 90_000)
          throw new Error('X security verification did not clear within 90 s')
      } else if (url.pathname.startsWith('/i/flow/login') || url.pathname === '/login') {
        throw new Error(
          'X asked to sign in: the saved session has expired. Renew it with `ceremony export x` (libid-server-rs).',
        )
      } else if (url.pathname.startsWith('/i/oauth2/authorize')) {
        challengedAt = undefined
        if (!cookiesAccepted)
          cookiesAccepted = await click(popup.getByRole('button', { name: 'Accept all cookies' }))
        // X serves more than one consent page.
        await click(
          popup
            .getByTestId('OAuth_Consent_Button')
            .or(popup.getByRole('button', { name: /^authorize app$/i })),
        )
      }
    },
  })
}
