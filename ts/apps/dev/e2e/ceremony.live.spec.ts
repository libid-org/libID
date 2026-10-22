import type { PlatformId } from '@libid/ceremony'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { authorizeOnGitHub, githubAccount } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { isLive, liveSecret } from './live.ts'
import { presentAsPerson } from './person.ts'
import { googleSession, restoreSession, xSession } from './session.ts'
import { authorizeOnX, restoreXSession } from './x.ts'

/** Proving in the browser, after the platform returns the popup. */
const OUTCOME_TIMEOUT = 8 * 60_000

type Name = 'GitHub' | 'X' | 'Google'

const platformOf: Record<Name, PlatformId> = { GitHub: 'github', X: 'x', Google: 'google' }

/** What the test reads of a run's entry in window.results. */
interface Outcome {
  status: string
  platformId?: string
  userId?: string
  userName?: string
  idNodeBytes?: number
  handleNodeBytes?: number
  proofPresent?: boolean
}

/**
 * Start the platform's ceremony from its anchor, let `authorize` drive the
 * popup through the platform, then check the run's result: accepted, the
 * proved account with its id and handle nodes, and a non-empty proof.
 */
async function proveThroughTheUi(
  page: Page,
  context: BrowserContext,
  name: Name,
  expectedUser: string,
  authorize: (popup: Page) => Promise<void>,
) {
  await page.goto('/')
  await expect(page.locator('#status')).toHaveText('Ready. Click a platform to start a ceremony.')
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name, exact: true }).click(),
  ])
  const id = await page.locator('#history tr').first().getAttribute('data-ceremony-id')
  expect(id).toBeTruthy()
  await authorize(popup)

  await expect
    .poll(() => page.evaluate((id) => window.results.has(id), id!), { timeout: OUTCOME_TIMEOUT })
    .toBe(true)
  const outcome = await page.evaluate((id): Outcome => {
    const result = window.results.get(id)!
    if (result.status !== 'accepted') return { status: result.status }
    const { identity, oauthProof } = result
    return {
      status: result.status,
      platformId: identity.platformId,
      userId: identity.userId,
      userName: identity.userName,
      idNodeBytes: identity.idNode.length,
      handleNodeBytes: identity.handleNode.length,
      proofPresent: Object.values(oauthProof.proof).some(
        (value) => value instanceof Uint8Array && value.length > 0,
      ),
    }
  }, id!)
  // A failed run's row says why.
  const message = await page
    .locator(`#history tr[data-ceremony-id="${id}"] .run-status`)
    .textContent()
  expect(outcome.status, message ?? undefined).toBe('accepted')
  expect(outcome.platformId).toBe(platformOf[name])
  // The account id as the platform sent it: GitHub's and X's are decimal.
  if (name === 'Google') expect(outcome.userId).not.toMatch(/^0x/)
  else expect(outcome.userId).toMatch(/^\d+$/)
  expect(outcome.userId).toBeTruthy()
  expect(outcome.userName?.toLowerCase()).toBe(expectedUser.toLowerCase())
  expect(outcome.idNodeBytes).toBe(32)
  expect(outcome.handleNodeBytes).toBe(32)
  expect(outcome.proofPresent).toBe(true)
}

test('a GitHub identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('github'), 'GitHub is not in LIBID_LIVE_PLATFORMS')
  const account = githubAccount()
  test.skip(!account, 'GH_TEST_ALICE_USERNAME, _PASSWORD and _TOTP_SECRET are not set')
  await proveThroughTheUi(page, context, 'GitHub', account!.username, (popup) =>
    authorizeOnGitHub(popup, account!),
  )
})

test('an X identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('x'), 'X is not in LIBID_LIVE_PLATFORMS')
  const session = xSession()
  test.skip(!session, 'X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE is not set')
  const username = liveSecret('X_TEST_ALICE_USERNAME')
  test.skip(!username, 'X_TEST_ALICE_USERNAME is not set')
  await presentAsPerson(context)
  await restoreXSession(context, session!)
  await proveThroughTheUi(page, context, 'X', username!, (popup) => authorizeOnX(popup))
})

test('a Google identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('google'), 'Google is not in LIBID_LIVE_PLATFORMS')
  const session = googleSession()
  test.skip(!session, 'GOOGLE_TEST_ALICE_COOKIES or GOOGLE_TEST_ALICE_COOKIES_FILE is not set')
  const email = liveSecret('GOOGLE_TEST_ALICE_EMAIL')
  test.skip(!email, 'GOOGLE_TEST_ALICE_EMAIL is not set')
  await presentAsPerson(context)
  await restoreSession(context, session!)
  await proveThroughTheUi(page, context, 'Google', email!, (popup) =>
    authorizeOnGoogle(popup, email!),
  )
})
