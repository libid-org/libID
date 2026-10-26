import type { PlatformId } from '@libid/ceremony'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { expectReady, launch, newestRun } from '../src/app.fixtures.ts'
import { authorizeOnGitHub } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { presentAsPerson } from './person.ts'
import { watchAppFailure, watchReturn } from './popup.ts'
import { googleSession, restoreSession, saveGoogleSession, xSession } from './session.ts'
import { env, missing, runnablePlatforms } from './settings.ts'
import { authorizeOnX } from './x.ts'

/**
 * Start `name`'s ceremony from the app, let `authorize` drive the popup, then
 * check the run's result: accepted, for `user` on `platform`. The ceremony
 * itself validates the proof, the nodes and the ids.
 */
async function proveThroughTheUi(
  page: Page,
  context: BrowserContext,
  name: string,
  platform: PlatformId,
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
  const result = () =>
    page.evaluate((id) => {
      const result = window.results.get(id)
      const identity = result && 'identity' in result ? result.identity : undefined
      return (
        result && {
          status: result.status,
          platform: identity?.platformId,
          user: identity?.userName,
        }
      )
    }, id)
  const message = async () => (await row.locator('.run-status').textContent()) ?? ''
  watchAppFailure(popup, async () => {
    const status = (await result())?.status
    return status && status !== 'accepted' ? await message() : undefined
  })
  await authorize(popup)

  await expect.poll(result, { timeout: 8 * 60_000 }).toBeDefined()
  const outcome = (await result())!
  if (outcome.status !== 'accepted') expect(outcome.status, await message()).toBe('accepted')
  expect(outcome.platform).toBe(platform)
  expect(outcome.user?.toLowerCase()).toBe(user.toLowerCase())
}

/** Skip `platform`'s test unless it runs: listed, or with its variables set. */
const skipUnlessLive = (platform: PlatformId) =>
  test.skip(
    !runnablePlatforms().includes(platform),
    `not listed in LIBID_LIVE_PLATFORMS, or ${missing(platform).join(', ')} not set`,
  )

test('a GitHub identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('github')
  const account = {
    username: env('GH_TEST_ALICE_USERNAME')!,
    password: env('GH_TEST_ALICE_PASSWORD')!,
    totpSecret: env('GH_TEST_ALICE_TOTP_SECRET')!,
  }
  await proveThroughTheUi(page, context, 'GitHub', 'github', account.username, (popup) =>
    authorizeOnGitHub(popup, account),
  )
})

test('an X identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('x')
  await presentAsPerson(context)
  await restoreSession(context, xSession()!)
  await proveThroughTheUi(page, context, 'X', 'x', env('X_TEST_ALICE_USERNAME')!, authorizeOnX)
})

test('a Google identity is proved in the browser', async ({ page, context }) => {
  skipUnlessLive('google')
  const email = env('GOOGLE_TEST_ALICE_EMAIL')!
  await presentAsPerson(context)
  await restoreSession(context, googleSession()!)
  await proveThroughTheUi(page, context, 'Google', 'google', email, (popup) =>
    authorizeOnGoogle(popup, email),
  )
  const out = env('GOOGLE_TEST_ALICE_COOKIES_OUT')
  if (out) await saveGoogleSession(context, out)
})
