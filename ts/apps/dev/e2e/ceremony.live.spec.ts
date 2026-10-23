import type { PlatformId } from '@libid/ceremony'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { expectReady, launch, newestRun } from '../src/app.fixtures.ts'
import { OUTCOME, READY } from './budgets.ts'
import { authorizeOnGitHub } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { presentAsPerson } from './person.ts'
import { watchAppFailure, watchReturn } from './popup.ts'
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

type Name = 'GitHub' | 'X' | 'Google'

const platformOf: Record<Name, PlatformId> = { GitHub: 'github', X: 'x', Google: 'google' }

/** The proof each platform's result carries: GitHub's and X's bearer link, Google's ZK proof. */
const proofField: Record<Name, string> = {
  GitHub: 'bearerLinkProof',
  X: 'bearerLinkProof',
  Google: 'identityProof',
}

/** What the test reads of a run's entry in window.results. */
interface Outcome {
  status: string
  platformId?: string
  userId?: string
  userName?: string
  idNodeBytes?: number
  handleNodeBytes?: number
  /** The byte length of each Uint8Array field of the proof, by name. */
  proofBytes?: Record<string, number>
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
  // A cold app loads the Bridge configuration and CCDP's version list first.
  await expectReady(page, READY)
  // Watched from the moment it appears: a platform may return it at once.
  context.on('page', watchReturn)
  const popup = await launch(page, name)
  const row = newestRun(page)
  const id = await row.getAttribute('data-ceremony-id')
  expect(id).toBeTruthy()
  // The driver stops with the app's reason once the run fails.
  watchAppFailure(popup, async () => {
    const status = await page.evaluate((id) => window.results.get(id)?.status, id!)
    if (!status || status === 'accepted') return undefined
    return (await row.locator('.run-status').textContent()) || status
  })
  await authorize(popup)

  await expect
    .poll(() => page.evaluate((id) => window.results.has(id), id!), { timeout: OUTCOME })
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
      proofBytes: Object.fromEntries(
        Object.entries(oauthProof.proof).flatMap(([field, value]) =>
          value instanceof Uint8Array ? [[field, value.length]] : [],
        ),
      ),
      ceremonyVersion: String(oauthProof.platformCeremonyVersion),
      expiresAt: oauthProof.expiresAt,
    }
  }, id!)
  // A failed run's row says why.
  const message = await row.locator('.run-status').textContent()
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
  expect(outcome.proofBytes?.[proofField[name]]).toBeGreaterThan(0)
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
