import type { PlatformId } from '@libid/ceremony'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { expectReady, launch, newestRun } from '../src/app.fixtures.ts'
import { authorizeOnGitHub } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { presentAsPerson } from './person.ts'
import { watchAppFailure, watchReturn } from './popup.ts'
import { googleSession, restoreSession, xSession } from './session.ts'
import { env, livePlatforms, missing } from './settings.ts'
import { authorizeOnX, restoreXSession } from './x.ts'

const PLATFORMS = {
  GitHub: { id: 'github', proof: 'bearerLinkProof' },
  X: { id: 'x', proof: 'bearerLinkProof' },
  Google: { id: 'google', proof: 'identityProof' },
} as const

/**
 * Start `name`'s ceremony from the app, let `authorize` drive the popup, then
 * check the run's result: accepted, the proved account and its nodes, and a
 * non-empty, unexpired proof.
 */
async function proveThroughTheUi(
  page: Page,
  context: BrowserContext,
  name: keyof typeof PLATFORMS,
  user: string,
  authorize: (popup: Page) => Promise<void>,
) {
  await page.goto('/')
  await expectReady(page, 60_000)
  // Watched as it appears: a platform may return it at once.
  context.on('page', watchReturn)
  const popup = await launch(page, name)
  const row = newestRun(page)
  const id = (await row.getAttribute('data-ceremony-id'))!
  const status = () => page.evaluate((id) => window.results.get(id)?.status, id)
  watchAppFailure(popup, async () => {
    const now = await status()
    return now && now !== 'accepted'
      ? (await row.locator('.run-status').textContent()) || now
      : undefined
  })
  await authorize(popup)

  await expect.poll(status, { timeout: 8 * 60_000 }).toBeDefined()
  expect(await status(), (await row.locator('.run-status').textContent()) ?? '').toBe('accepted')
  const result = await page.evaluate((id) => {
    const result = window.results.get(id)
    if (result?.status !== 'accepted') return undefined
    const { identity, oauthProof } = result
    const proof = oauthProof.proof as unknown as Record<string, unknown>
    return {
      platformId: identity.platformId,
      userId: identity.userId,
      userName: identity.userName.toLowerCase(),
      nodes: [identity.idNode.length, identity.handleNode.length],
      proofBytes: Object.fromEntries(
        Object.entries(proof).map(([field, value]) => [field, (value as Uint8Array)?.length]),
      ),
      version: oauthProof.platformCeremonyVersion,
      expiresAt: oauthProof.expiresAt,
    }
  }, id)
  const { id: platform, proof } = PLATFORMS[name]
  expect(result?.platformId).toBe(platform)
  // The account id as sent: GitHub's and X's are decimal; Google's `sub`, any string.
  expect(result?.userId).toMatch(name === 'Google' ? /^(?!0x)./ : /^\d+$/)
  expect(result?.userName).toBe(user.toLowerCase())
  expect(result?.nodes).toEqual([32, 32])
  expect(result?.proofBytes[proof]).toBeGreaterThan(0)
  expect(result?.version).toBeGreaterThan(0)
  expect(result?.expiresAt).toBeGreaterThan(Date.now() / 1000)
}

/** Skip `platform`'s test unless it is selected and its settings are all set. */
function skipUnlessLive(platform: PlatformId) {
  test.skip(!livePlatforms().includes(platform), `${platform} is not in LIBID_LIVE_PLATFORMS`)
  test.skip(missing(platform).length > 0, `${missing(platform).join(', ')} not set`)
}

test('a GitHub identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('github')
  const account = {
    username: env('GH_TEST_ALICE_USERNAME')!,
    password: env('GH_TEST_ALICE_PASSWORD')!,
    totpSecret: env('GH_TEST_ALICE_TOTP_SECRET')!,
  }
  await proveThroughTheUi(page, context, 'GitHub', account.username, (popup) =>
    authorizeOnGitHub(popup, account),
  )
})

test('an X identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('x')
  await presentAsPerson(context)
  await restoreXSession(context, xSession()!)
  await proveThroughTheUi(page, context, 'X', env('X_TEST_ALICE_USERNAME')!, authorizeOnX)
})

test('a Google identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('google')
  const email = env('GOOGLE_TEST_ALICE_EMAIL')!
  await presentAsPerson(context)
  await restoreSession(context, googleSession()!)
  await proveThroughTheUi(page, context, 'Google', email, (popup) =>
    authorizeOnGoogle(popup, email),
  )
})
