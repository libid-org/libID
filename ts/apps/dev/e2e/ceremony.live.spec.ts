import type { PlatformId } from '@libid/ceremony'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { authorizeOnGitHub } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { presentAsPerson } from './person.ts'
import { googleSession, restoreSession, xSession } from './session.ts'
import {
  githubAccount,
  googleAccount,
  isLive,
  missing,
  type Section,
  xAccount,
} from './settings.ts'
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
  ceremonyVersion?: string
  expiresAt?: number
}

/**
 * Start the platform's ceremony from its anchor, let `authorize` drive the
 * popup through the platform, then check the run's result: accepted, the
 * proved account with its id and handle nodes, the ceremony version, and a
 * non-empty, unexpired proof.
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
      ceremonyVersion: String(oauthProof.platformCeremonyVersion),
      expiresAt: oauthProof.expiresAt,
    }
  }, id!)
  // A failed run's row says why.
  const message = await page
    .locator(`#history tr[data-ceremony-id="${id}"] .run-status`)
    .textContent()
  expect(outcome.status, message ?? undefined).toBe('accepted')
  expect(outcome.platformId).toBe(platformOf[name])
  // The account id as the platform sent it: GitHub's and X's are decimal, and
  // @libid/contracts' id rules admit any string bytes for Google's `sub`.
  if (name === 'Google') expect(outcome.userId).not.toMatch(/^0x/)
  else expect(outcome.userId).toMatch(/^\d+$/)
  expect(outcome.userId).toBeTruthy()
  expect(outcome.userName?.toLowerCase()).toBe(expectedUser.toLowerCase())
  expect(outcome.idNodeBytes).toBe(32)
  expect(outcome.handleNodeBytes).toBe(32)
  expect(outcome.proofPresent).toBe(true)
  expect(outcome.ceremonyVersion).toMatch(/^[1-9]\d*$/)
  expect(outcome.expiresAt).toBeGreaterThan(Date.now() / 1000)
}

/** Why `section`'s test is skipped: the variables it lacks. */
const lacking = (...sections: Section[]) =>
  `${sections.flatMap((s) => missing(s)).join(', ')} not set`

test('a GitHub identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('github'), 'GitHub is not in LIBID_LIVE_PLATFORMS')
  const account = githubAccount()
  test.skip(!account, lacking('github-account'))
  await proveThroughTheUi(page, context, 'GitHub', account!.username, (popup) =>
    authorizeOnGitHub(popup, account!),
  )
})

test('an X identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('x'), 'X is not in LIBID_LIVE_PLATFORMS')
  const session = xSession()
  const account = xAccount()
  test.skip(!session || !account, lacking('x-account', 'x-session'))
  await presentAsPerson(context)
  await restoreXSession(context, session!)
  await proveThroughTheUi(page, context, 'X', account!.username, (popup) => authorizeOnX(popup))
})

test('a Google identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('google'), 'Google is not in LIBID_LIVE_PLATFORMS')
  const session = googleSession()
  const account = googleAccount()
  test.skip(!session || !account, lacking('google-account', 'google-session'))
  await presentAsPerson(context)
  await restoreSession(context, session!)
  await proveThroughTheUi(page, context, 'Google', account!.email, (popup) =>
    authorizeOnGoogle(popup, account!.email),
  )
})
