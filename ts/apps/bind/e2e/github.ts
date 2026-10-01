import type { Page } from '@playwright/test'
import * as OTPAuth from 'otpauth'

export interface GitHubAccount {
  username: string
  password: string
  totpSecret: string
}

/** The test account, from GH_TEST_ALICE_*; undefined when any is missing. */
export function githubAccount(): GitHubAccount | undefined {
  const username = process.env.GH_TEST_ALICE_USERNAME
  const password = process.env.GH_TEST_ALICE_PASSWORD
  const totpSecret = process.env.GH_TEST_ALICE_TOTP_SECRET
  return username && password && totpSecret ? { username, password, totpSecret } : undefined
}

function totp(secret: string): string {
  const normalized = secret.replace(/\s/g, '').toUpperCase()
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(normalized), algorithm: 'SHA1', digits: 6, period: 30 }).generate()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sign in and authorize on GitHub in `popup`, until it leaves github.com. A
 * port of libid-server-rs' ceremony-tests/src/browser/github.rs: fill the login
 * form once, answer the authenticator step once per 30-second code, approve the
 * OAuth app, and back off on GitHub's error and rate-limit pages.
 */
export async function authorizeOnGitHub(popup: Page, account: GitHubAccount, budgetMs = 180_000) {
  const started = Date.now()
  let filled = false
  let totpStep: number | undefined
  let rateLimited = 0
  let errored = 0

  while (Date.now() - started < budgetMs) {
    if (popup.isClosed()) return
    let url: URL
    try {
      url = new URL(popup.url())
    } catch {
      await sleep(250)
      continue
    }
    if (url.hostname !== 'github.com') {
      // Before GitHub (Prefetch) or after it (Callback, Prover): not ours to drive.
      if (filled || url.pathname.startsWith('/auth/callback')) return
      await sleep(250)
      continue
    }
    const text = ((await popup.locator('body').textContent().catch(() => '')) ?? '').toLowerCase()
    if (text.includes("couldn't respond to your request in time") || text.includes('something went wrong')) {
      errored += 1
      if (errored > 3) throw new Error('GitHub answered its error page three times')
      await sleep(10_000 * errored)
      await popup.goBack().catch(() => {})
      filled = false
      totpStep = undefined
      continue
    }
    const path = url.pathname
    if (path === '/login' || path === '/session') {
      if (text.includes('too many requests') || text.includes('rate limit')) {
        rateLimited += 1
        if (rateLimited > 3) throw new Error('GitHub rate-limited the login three times')
        await sleep(30_000 * rateLimited)
        await popup.reload()
        filled = false
        continue
      }
      if (!filled && (await popup.locator('#login_field').count())) {
        await popup.fill('#login_field', account.username)
        await popup.fill('#password', account.password)
        await popup.click('input[type=submit][name=commit]')
        filled = true
      }
    } else if (path === '/sessions/two-factor/app') {
      const step = Math.floor(Date.now() / 30_000)
      if (totpStep !== step && (await popup.locator('#app_totp').count())) {
        await popup.fill('#app_totp', totp(account.totpSecret))
        // GitHub submits the code on its own once six digits are in.
        await popup.locator('button[type=submit]').click({ timeout: 2_000 }).catch(() => {})
        totpStep = step
      }
    } else if (path.startsWith('/sessions/two-factor')) {
      await popup.goto('https://github.com/sessions/two-factor/app')
    } else if (path === '/login/oauth/authorize') {
      const authorize = popup.locator("button[name='authorize'][value='1']")
      if (await authorize.count()) await authorize.click()
      else if (text.includes('redirect_uri') || text.includes('be careful'))
        throw new Error("GitHub refused the authorization request: the app's callback URL does not match")
    } else if (path.startsWith('/sessions/verified-device')) {
      throw new Error('GitHub asked for device verification: the account has no TOTP method')
    }
    await sleep(250)
  }
  throw new Error(`No GitHub authorization in ${budgetMs / 1000} s; stopped on ${popup.url()}`)
}
