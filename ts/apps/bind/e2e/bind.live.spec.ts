import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { RPC_URL } from '../local.ts'
import { authorizeOnGitHub, githubAccount } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { isLive, liveSecret } from './live.ts'
import { presentAsPerson } from './person.ts'
import { googleSession, restoreSession, xSession } from './session.ts'
import { injectWallet } from './wallet.ts'
import { authorizeOnX, restoreXSession } from './x.ts'

/** anvil account #2: unlocked by anvil, funded, and not one the deploy uses. */
const HOLDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
/** Proving, the transaction, and the indexer's poll, after the platform returns. */
const OUTCOME_TIMEOUT = 8 * 60_000

/**
 * Connect the wallet, start the platform's ceremony from its link, let
 * `authorize` drive the popup through the platform, then check every step the
 * page reports: the proved account, the transaction, its receipt, and the
 * holder the registry and the indexer return.
 */
async function bindThroughTheUi(
  page: Page,
  context: BrowserContext,
  platform: 'GitHub' | 'X' | 'Google',
  expectedUser: string,
  authorize: (popup: Page) => Promise<void>,
) {
  await injectWallet(context, RPC_URL, HOLDER)
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('Connect a wallet to start.')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByTestId('holder')).toHaveText(HOLDER)

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: `Bind ${platform}` }).click(),
  ])
  await authorize(popup)

  // The page reports one outcome when the run ends, its own message on failure.
  const outcome = page.getByTestId('outcome')
  await expect(outcome).not.toHaveText('—', { timeout: OUTCOME_TIMEOUT })
  await expect(outcome).toHaveText('bound')
  await expect(page.getByTestId('proof-received')).toContainText(expectedUser, { ignoreCase: true })
  await expect(page.getByTestId('tx-hash')).toHaveText(/^0x[0-9a-f]{64}$/)
  await expect(page.getByTestId('receipt-status')).toHaveText(/^success in block \d+$/)
  await expect(page.getByTestId('registry-holder')).toHaveText(HOLDER)
  await expect(page.getByTestId('indexer-holder')).toHaveText(new RegExp(`^${HOLDER}$`, 'i'))
}

test('a GitHub identity is proved in the browser, bound on chain, and shown', async ({
  page,
  context,
}) => {
  test.skip(!isLive('github'), 'GitHub is not in LIBID_LIVE_PLATFORMS')
  const account = githubAccount()
  test.skip(!account, 'GH_TEST_ALICE_USERNAME, _PASSWORD and _TOTP_SECRET are not set')
  await bindThroughTheUi(page, context, 'GitHub', account!.username, (popup) =>
    authorizeOnGitHub(popup, account!),
  )
})

test('an X identity is proved in the browser, bound on chain, and shown', async ({
  page,
  context,
}) => {
  test.skip(!isLive('x'), 'X is not in LIBID_LIVE_PLATFORMS')
  const session = xSession()
  test.skip(!session, 'X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE is not set')
  const username = liveSecret('X_TEST_ALICE_USERNAME')
  test.skip(!username, 'X_TEST_ALICE_USERNAME is not set')
  await presentAsPerson(context)
  await restoreXSession(context, session!)
  await bindThroughTheUi(page, context, 'X', username!, (popup) => authorizeOnX(popup))
})

test('a Google identity is proved in the browser, bound on chain, and shown', async ({
  page,
  context,
}) => {
  test.skip(!isLive('google'), 'Google is not in LIBID_LIVE_PLATFORMS')
  const session = googleSession()
  test.skip(!session, 'GOOGLE_TEST_ALICE_COOKIES or GOOGLE_TEST_ALICE_COOKIES_FILE is not set')
  const email = liveSecret('GOOGLE_TEST_ALICE_EMAIL')
  test.skip(!email, 'GOOGLE_TEST_ALICE_EMAIL is not set')
  await presentAsPerson(context)
  await restoreSession(context, session!)
  await bindThroughTheUi(page, context, 'Google', email!, (popup) =>
    authorizeOnGoogle(popup, email!),
  )
})
