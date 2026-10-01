import { expect, test } from '@playwright/test'
import { authorizeOnGitHub, githubAccount } from './github.ts'
import { injectWallet } from './wallet.ts'

const RPC_URL = 'http://127.0.0.1:4688'
/** anvil account #2: unlocked by anvil, funded, and not one the deploy uses. */
const HOLDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

test('a GitHub identity is proved in the browser, bound on chain, and shown', async ({ page, context }) => {
  const account = githubAccount()
  test.skip(!account, 'GH_TEST_ALICE_USERNAME, _PASSWORD and _TOTP_SECRET are not set')

  await injectWallet(context, RPC_URL, HOLDER)
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('Connect a wallet to start.')

  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByTestId('holder')).toHaveText(HOLDER)

  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Bind GitHub' }).click()])
  await authorizeOnGitHub(popup, account!)

  // Proving runs in the popup's Prover document after the OAuth return.
  await expect(page.getByTestId('proof-received')).toContainText(account!.username, { ignoreCase: true, timeout: 300_000 })
  await expect(page.getByTestId('tx-hash')).toHaveText(/^0x[0-9a-f]{64}$/, { timeout: 60_000 })
  await expect(page.getByTestId('receipt-status')).toHaveText(/^success in block \d+$/, { timeout: 60_000 })
  await expect(page.getByTestId('registry-holder')).toHaveText(HOLDER)
  await expect(page.getByTestId('indexer-holder')).toHaveText(new RegExp(`^${HOLDER}$`, 'i'), { timeout: 90_000 })
})
