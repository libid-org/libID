import { setTimeout as sleep } from 'node:timers/promises'
import type { Locator, Page } from '@playwright/test'
import { BRIDGE } from '../local.ts'

const BUDGET_MS = 180_000

/** Where every platform returns the popup: the local Bridge's OAuth callback. */
const CALLBACK = new URL('/auth/callback', BRIDGE)

/** Wait `ms` inside the driver's budget; reject with `reason` if the wait would pass it. */
export type Pause = (ms: number, reason: string) => Promise<void>

interface Driver {
  /** The platform's name, for the timeout message. */
  name: string
  /** Whether `url` is one of the platform's own pages. */
  onHost: (url: URL) => boolean
  /**
   * Act on one of the platform's pages; `text` is its visible text, whitespace
   * collapsed, lowercased, with typographic apostrophes as plain ones.
   */
  step: (url: URL, text: string, pause: Pause) => Promise<void>
}

const isCallback = (url: string) => {
  const parsed = URL.parse(url)
  return parsed?.origin === CALLBACK.origin && parsed.pathname === CALLBACK.pathname
}

const returned = new WeakSet<Page>()

/** Note `popup`'s navigation to Bridge's callback from now on; call it as the popup appears. */
export const watchReturn = (popup: Page) =>
  popup.on('request', (request) => {
    if (request.isNavigationRequest() && isCallback(request.url())) returned.add(popup)
  })

const failures = new WeakMap<Page, () => Promise<string | undefined>>()

/** Let `drivePopup` stop with the app's reason once `check` reports its run failed. */
export const watchAppFailure = (popup: Page, check: () => Promise<string | undefined>) =>
  failures.set(popup, check)

/**
 * Drive `popup` through a platform's pages until the platform sends it to
 * Bridge's callback; fail on the budget, naming the page it stopped on.
 */
export async function drivePopup(popup: Page, driver: Driver) {
  const deadline = Date.now() + BUDGET_MS
  const hasReturned = () => returned.has(popup) || (!popup.isClosed() && isCallback(popup.url()))
  const pause: Pause = async (ms, reason) => {
    if (Date.now() + ms > deadline)
      throw new Error(
        `${reason}; waiting ${ms / 1000} s more would pass the ${BUDGET_MS / 1000} s budget`,
      )
    await sleep(ms)
  }
  let checkedAt = 0
  while (Date.now() < deadline) {
    if (hasReturned()) return
    if (Date.now() - checkedAt > 2_000) {
      checkedAt = Date.now()
      const failed = await failures.get(popup)?.()
      if (failed)
        throw new Error(`The app's run failed during the ${driver.name} authorization: ${failed}`)
    }
    if (popup.isClosed())
      throw new Error(`The popup closed before ${driver.name} returned it to Bridge`)
    const url = URL.parse(popup.url())
    if (url?.protocol === 'chrome-error:')
      throw new Error(`The popup could not load a page during the ${driver.name} authorization`)
    if (url && driver.onHost(url)) {
      const visible = await popup
        .locator('body')
        .innerText({ timeout: 2_000 })
        .catch(() => '')
      const text = visible.split(/\s+/).join(' ').trim().toLowerCase().replaceAll('’', "'")
      await driver.step(url, text, pause)
    }
    await sleep(250)
  }
  if (hasReturned()) return
  throw new Error(
    `No ${driver.name} authorization in ${BUDGET_MS / 1000} s; stopped on ${popup.url()}`,
  )
}

/** A click on the first visible match of a locator, at most once every 5 s; whether it found one. */
export function throttledClick() {
  let clickedAt = 0
  return async (target: Locator) => {
    const visible = target.filter({ visible: true }).first()
    if (Date.now() - clickedAt < 5_000 || !(await visible.count())) return false
    clickedAt = Date.now()
    // The page may already be leaving; the next poll sees where it went.
    await visible.click({ timeout: 5_000 }).catch(() => {})
    return true
  }
}
