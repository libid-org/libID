import { setTimeout as sleep } from 'node:timers/promises'
import type { Page } from '@playwright/test'

export { sleep }

const BUDGET_MS = 180_000

export interface Driver {
  /** The platform's name, for the timeout message. */
  name: string
  /** Whether `url` is one of the platform's own pages. */
  onHost: (url: URL) => boolean
  /** Act on one of the platform's pages; `text` is its body, lowercased. */
  step: (url: URL, text: string) => Promise<void>
}

/**
 * Drive `popup` through a platform's pages until it leaves them: the OAuth
 * return, after which Callback and Prover take over.
 */
export async function drivePopup(popup: Page, driver: Driver) {
  const started = Date.now()
  let visited = false
  while (Date.now() - started < BUDGET_MS) {
    if (popup.isClosed()) return
    const url = URL.parse(popup.url())
    if (url && driver.onHost(url)) {
      visited = true
      const text = (
        (await popup
          .locator('body')
          .textContent()
          .catch(() => '')) ?? ''
      ).toLowerCase()
      await driver.step(url, text)
    } else if (url && visited) {
      return
    }
    await sleep(250)
  }
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
