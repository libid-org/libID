import { setTimeout as sleep } from 'node:timers/promises'
import type { Page } from '@playwright/test'
import { BRIDGE } from '../local.ts'

const BUDGET_MS = 180_000

/** Where every platform returns the popup: Bridge's OAuth callback. */
const CALLBACK = new URL('/auth/callback', BRIDGE)

/** Wait `ms` inside the driver's budget; reject with `reason` if the wait would pass it. */
export type Pause = (ms: number, reason: string) => Promise<void>

export interface Driver {
  /** The platform's name, for the timeout message. */
  name: string
  /** Whether `url` is one of the platform's own pages. */
  onHost: (url: URL) => boolean
  /**
   * Act on one of the platform's pages; `text` is its body, lowercased, with
   * typographic apostrophes as plain ones.
   */
  step: (url: URL, text: string, pause: Pause) => Promise<void>
}

const isCallback = (url: string) => {
  const parsed = URL.parse(url)
  return parsed?.origin === CALLBACK.origin && parsed.pathname === CALLBACK.pathname
}

/**
 * Drive `popup` through a platform's pages until the platform sends it to
 * Bridge's callback, after which Callback and Prover take over. Leaving the
 * platform for anywhere else is not a return: the driver keeps waiting, and
 * fails on its budget naming the page it stopped on.
 */
export async function drivePopup(popup: Page, driver: Driver) {
  const deadline = Date.now() + BUDGET_MS
  // A request, not a committed page: the callback may redirect on at once.
  let returned = false
  const onRequest = (request: { url(): string; isNavigationRequest(): boolean }) => {
    if (request.isNavigationRequest() && isCallback(request.url())) returned = true
  }
  popup.on('request', onRequest)
  const pause: Pause = async (ms, reason) => {
    if (Date.now() + ms > deadline)
      throw new Error(
        `${reason}; waiting ${ms / 1000} s more would pass the ${BUDGET_MS / 1000} s budget`,
      )
    await sleep(ms)
  }
  try {
    while (Date.now() < deadline) {
      if (returned) return
      if (popup.isClosed())
        throw new Error(`The popup closed before ${driver.name} returned it to Bridge`)
      const url = URL.parse(popup.url())
      if (url?.protocol === 'chrome-error:')
        throw new Error(`The popup could not load a page during the ${driver.name} authorization`)
      if (url && driver.onHost(url)) {
        const text = (
          (await popup
            .locator('body')
            .textContent()
            .catch(() => '')) ?? ''
        )
          .toLowerCase()
          .replaceAll('’', "'")
        await driver.step(url, text, pause)
      }
      await sleep(250)
    }
  } finally {
    popup.off('request', onRequest)
  }
  if (returned) return
  throw new Error(
    `No ${driver.name} authorization in ${BUDGET_MS / 1000} s; stopped on ${popup.url()}`,
  )
}

/**
 * Run `mark`, a page script that tags the control to press with
 * `data-libid-click` and returns whether it found one, then click that control
 * for real.
 */
export async function clickMarked(popup: Page, mark: string): Promise<boolean> {
  if (!(await popup.evaluate(mark).catch(() => false))) return false
  await popup
    .locator('[data-libid-click="1"]')
    .click({ timeout: 5_000 })
    .catch(() => {})
  return true
}
