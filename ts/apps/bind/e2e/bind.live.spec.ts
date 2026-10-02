import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { authorizeOnGitHub, githubAccount } from './github.ts'
import { presentAsPerson } from './person.ts'
import { injectWallet } from './wallet.ts'
import { authorizeOnX, restoreXSession, xSession } from './x.ts'

const RPC_URL = 'http://127.0.0.1:4688'
/** anvil account #2: unlocked by anvil, funded, and not one the deploy uses. */
const HOLDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

/**
 * Connect the wallet, start the platform's ceremony from its link, let
 * `authorize` drive the popup through the platform, then check every step the
 * page reports: the proved account, the transaction, its receipt, and the
 * holder the registry and the indexer return.
 */
async function bindThroughTheUi(
  page: Page,
  context: BrowserContext,
  platform: 'GitHub' | 'X',
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

  // Proving runs in the popup's Prover document after the OAuth return.
  await expect(page.getByTestId('proof-received')).toContainText(expectedUser, {
    ignoreCase: true,
    timeout: 300_000,
  })
  await expect(page.getByTestId('tx-hash')).toHaveText(/^0x[0-9a-f]{64}$/, { timeout: 60_000 })
  await expect(page.getByTestId('receipt-status')).toHaveText(/^success in block \d+$/, {
    timeout: 60_000,
  })
  await expect(page.getByTestId('registry-holder')).toHaveText(HOLDER)
  await expect(page.getByTestId('indexer-holder')).toHaveText(new RegExp(`^${HOLDER}$`, 'i'), {
    timeout: 90_000,
  })
}

test('a GitHub identity is proved in the browser, bound on chain, and shown', async ({
  page,
  context,
}) => {
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
  const session = xSession()
  test.skip(!session, 'X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE is not set')
  const username = process.env.X_TEST_ALICE_USERNAME
  test.skip(!username, 'X_TEST_ALICE_USERNAME is not set')
  await presentAsPerson(context)
  await restoreXSession(context, session!)
  await bindThroughTheUi(page, context, 'X', username!, (popup) => authorizeOnX(popup))
})
