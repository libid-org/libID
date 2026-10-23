import type { Page } from '@playwright/test'
import * as OTPAuth from 'otpauth'
import { drivePopup, type Pause, throttledClick } from './popup.ts'

interface GitHubAccount {
  username: string
  password: string
  /** The base32 key of the account's authenticator app. */
  totpSecret: string
}

/** The TOTP code for the base32 `secret`, spaces and case aside, at `time` (ms). */
export function totp(secret: string, time = Date.now()): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret.replace(/\s/g, '').toUpperCase()),
  }).generate({ timestamp: time })
}

/** What the login has done so far: the request a restart reopens, the login filled, the
 * step whose code went, the button clicks, and back-off counts. */
interface Progress {
  start?: string
  filled: boolean
  totpStep?: number
  click: ReturnType<typeof throttledClick>
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

async function onLogin(popup: Page, account: GitHubAccount, progress: Progress) {
  if (progress.filled || !(await popup.locator('#login_field').count())) return
  progress.filled = true
  await popup.fill('#login_field', account.username)
  await popup.fill('#password', account.password)
  await popup.click('input[type=submit][name=commit]')
}

/** One code per 30-second step, submitted once: GitHub submits a full code itself. */
async function onTotp(popup: Page, account: GitHubAccount, progress: Progress) {
  const now = Date.now()
  const step = Math.floor(now / 30_000)
  if (progress.totpStep === step || !(await popup.locator('#app_totp').count())) return
  progress.totpStep = step
  await popup.fill('#app_totp', totp(account.totpSecret, now))
  const left = await popup
    .waitForURL((url) => url.pathname !== '/sessions/two-factor/app', { timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (!left)
    await popup
      .locator('button[type=submit]')
      .click({ timeout: 2_000 })
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
  ) {
    await backOff(progress, 'errored', 10_000, 'GitHub answered its error page', pause)
    // Reopening the request keeps the popup on github.com until GitHub redirects.
    await popup.goto(progress.start).catch(() => {})
    progress.filled = false
    progress.totpStep = undefined
  } else if (path === '/login' || path === '/session') {
    if (text.includes('too many requests') || text.includes('rate limit')) {
      await backOff(progress, 'rateLimited', 30_000, 'GitHub rate-limited the login', pause)
      await popup.reload().catch(() => {})
      progress.filled = false
    } else await onLogin(popup, account, progress)
  } else if (path === '/sessions/two-factor/app') await onTotp(popup, account, progress)
  else if (path.startsWith('/sessions/two-factor'))
    await popup.goto('https://github.com/sessions/two-factor/app').catch(() => {})
  else if (path.startsWith('/sessions/verified-device'))
    throw new Error('GitHub asked for device verification: the account has no TOTP method')
  // GitHub's periodic 2FA checkup, served in place of the page asked for.
  else if (text.includes('verify your two-factor authentication'))
    await progress.click(popup.getByText('skip 2FA verification'))
  else if (path === '/login/oauth/authorize') {
    const authorized = await progress.click(popup.locator("button[name='authorize'][value='1']"))
    if (!authorized && (text.includes('redirect_uri') || text.includes('be careful')))
      throw new Error(
        "GitHub refused the authorization request: the app's callback URL does not match",
      )
  }
}

/**
 * Sign in and authorize on GitHub in `popup`, until GitHub redirects it to
 * Bridge's callback. A port of libid-server-rs' ceremony-tests/src/browser/github.rs.
 */
export async function authorizeOnGitHub(popup: Page, account: GitHubAccount) {
  const progress: Progress = {
    filled: false,
    click: throttledClick(),
    rateLimited: 0,
    errored: 0,
  }
  await drivePopup(popup, {
    name: 'GitHub',
    onHost: (url) => url.hostname === 'github.com',
    step: (url, text, pause) => onGitHubPage(popup, account, progress, url, text, pause),
  })
}
