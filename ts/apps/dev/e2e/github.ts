import type { Page } from '@playwright/test'
import * as OTPAuth from 'otpauth'
import { drivePopup, type Pause } from './popup.ts'
import type { GitHubAccount } from './settings.ts'

/** The longest a fill or click may take; a navigation gets twice that. */
const STEP_TIMEOUT = 5_000

function totp(secret: string): string {
  const normalized = secret.replace(/\s/g, '').toUpperCase()
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(normalized),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate()
}

/** What the login has done so far; each handler reads and updates it. */
interface Progress {
  /** The first GitHub page of the run: the authorization request, which a restart reopens. */
  start?: string
  filled: boolean
  totpStep?: number
  /** When the authorize button was last clicked; it is not clicked again within 5 s. */
  authorizedAt: number
  /** When the 2FA checkup was last skipped; it is not skipped again within 5 s. */
  skippedCheckupAt: number
  rateLimited: number
  errored: number
}

/** Count one more `what` under `counter`; wait `step` times the count, failing on the fourth. */
async function backOff(
  progress: Progress,
  counter: 'rateLimited' | 'errored',
  step: number,
  what: string,
  pause: Pause,
) {
  const count = ++progress[counter]
  if (count > 3) throw new Error(`${what} three times`)
  await pause(step * count, `${what} ${count} times`)
}

async function onErrorPage(popup: Page, progress: Progress, pause: Pause) {
  await backOff(progress, 'errored', 10_000, 'GitHub answered its error page', pause)
  // Reopening the request keeps the popup on github.com until GitHub redirects.
  if (progress.start)
    await popup.goto(progress.start, { timeout: STEP_TIMEOUT * 2 }).catch(() => {})
  progress.filled = false
  progress.totpStep = undefined
}

async function onLogin(
  popup: Page,
  account: GitHubAccount,
  progress: Progress,
  text: string,
  pause: Pause,
) {
  if (text.includes('too many requests') || text.includes('rate limit')) {
    await backOff(progress, 'rateLimited', 30_000, 'GitHub rate-limited the login', pause)
    await popup.reload({ timeout: STEP_TIMEOUT * 2 }).catch(() => {})
    progress.filled = false
    return
  }
  if (text.includes('incorrect username or password'))
    throw new Error('GitHub refused the username or password: check GH_TEST_ALICE_*')
  if (progress.filled || !(await popup.locator('#login_field').count())) return
  // A step that fails is tried again on the next poll, inside drivePopup's budget.
  try {
    await popup.fill('#login_field', account.username, { timeout: STEP_TIMEOUT })
    await popup.fill('#password', account.password, { timeout: STEP_TIMEOUT })
    await popup.click('input[type=submit][name=commit]', { timeout: STEP_TIMEOUT })
  } catch {
    return
  }
  progress.filled = true
}

async function onTotp(popup: Page, account: GitHubAccount, progress: Progress) {
  const step = Math.floor(Date.now() / 30_000)
  if (progress.totpStep === step || !(await popup.locator('#app_totp').count())) return
  try {
    await popup.fill('#app_totp', totp(account.totpSecret), { timeout: STEP_TIMEOUT })
  } catch {
    return
  }
  // GitHub submits the code on its own once six digits are in.
  await popup
    .locator('button[type=submit]')
    .click({ timeout: 2_000 })
    .catch(() => {})
  progress.totpStep = step
}

async function onAuthorize(popup: Page, progress: Progress, text: string) {
  const authorize = popup.locator("button[name='authorize'][value='1']")
  if (await authorize.count()) {
    if (Date.now() - progress.authorizedAt < 5_000) return
    progress.authorizedAt = Date.now()
    // The page may already be leaving for the redirect; the next poll sees where it went.
    await authorize.click({ timeout: 5_000 }).catch(() => {})
  } else if (text.includes('redirect_uri') || text.includes('be careful'))
    throw new Error(
      "GitHub refused the authorization request: the app's callback URL does not match",
    )
}

async function onTwoFactorCheckup(popup: Page, progress: Progress) {
  if (Date.now() - progress.skippedCheckupAt < 5_000) return
  progress.skippedCheckupAt = Date.now()
  await popup
    .getByText('skip 2FA verification')
    .click({ timeout: 5_000 })
    .catch(() => {})
}

/** Act on one GitHub page. */
async function onGitHubPage(
  popup: Page,
  account: GitHubAccount,
  progress: Progress,
  url: URL,
  text: string,
  pause: Pause,
) {
  progress.start ??= url.href
  const path = url.pathname
  if (
    text.includes("couldn't respond to your request in time") ||
    text.includes('something went wrong')
  )
    return onErrorPage(popup, progress, pause)
  // GitHub's periodic 2FA checkup, served in place of the page asked for.
  if (text.includes('verify your two-factor authentication'))
    return onTwoFactorCheckup(popup, progress)
  if (path === '/login' || path === '/session')
    return onLogin(popup, account, progress, text, pause)
  if (path === '/sessions/two-factor/app') return onTotp(popup, account, progress)
  if (path.startsWith('/sessions/two-factor')) {
    await popup
      .goto('https://github.com/sessions/two-factor/app', { timeout: STEP_TIMEOUT * 2 })
      .catch(() => {})
    return
  }
  if (path === '/login/oauth/authorize') return onAuthorize(popup, progress, text)
  if (path.startsWith('/sessions/verified-device'))
    throw new Error('GitHub asked for device verification: the account has no TOTP method')
}

/**
 * Sign in and authorize on GitHub in `popup`, until GitHub redirects it to
 * Bridge's callback. A port of libid-server-rs' ceremony-tests/src/browser/github.rs:
 * fill the login form once, answer the authenticator step once per 30-second
 * code, skip the 2FA checkup, approve the OAuth app, back off on rate-limit pages, and start the
 * authorization over on GitHub's error page.
 */
export async function authorizeOnGitHub(popup: Page, account: GitHubAccount) {
  const progress: Progress = {
    filled: false,
    authorizedAt: 0,
    skippedCheckupAt: 0,
    rateLimited: 0,
    errored: 0,
  }
  await drivePopup(popup, {
    name: 'GitHub',
    onHost: (url) => url.hostname === 'github.com',
    step: (url, text, pause) => onGitHubPage(popup, account, progress, url, text, pause),
  })
}
