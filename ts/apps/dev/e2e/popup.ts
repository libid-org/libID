import { setTimeout as sleep } from 'node:timers/promises'
import type { Page, Request } from '@playwright/test'
import { BRIDGE } from '../local.ts'
import { DRIVER } from './budgets.ts'

const BUDGET_MS = DRIVER

/** Where every platform returns the popup: the local Bridge's OAuth callback. */
const CALLBACK = new URL('/auth/callback', BRIDGE)

/** Wait `ms` inside the driver's budget; reject with `reason` if the wait would pass it. */
export type Pause = (ms: number, reason: string) => Promise<void>

export interface Driver {
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

const returns = new WeakMap<Page, { returned: boolean }>()

/**
 * Watch `popup` for its return to Bridge's callback, from now on. Call it as
 * the popup appears (in the `page` event's predicate): a platform that needs
 * no consent redirects at once. A request, not a committed page, counts: the
 * callback may redirect on at once.
 */
export function watchReturn(popup: Page): { returned: boolean } {
  let watch = returns.get(popup)
  if (!watch) {
    const state = { returned: isCallback(popup.url()) }
    popup.on('request', (request: Request) => {
      if (request.isNavigationRequest() && isCallback(request.url())) state.returned = true
    })
    returns.set(popup, state)
    watch = state
  }
  return watch
}

/** What a step that outlasts the driver's budget resolves to. */
const LATE: unique symbol = Symbol('late')

const failures = new WeakMap<Page, () => Promise<string | undefined>>()

/**
 * Let `drivePopup` stop early when the app's run for `popup` failed: `check`
 * resolves to the app's reason, or undefined while the run goes on.
 */
export const watchAppFailure = (popup: Page, check: () => Promise<string | undefined>) =>
  failures.set(popup, check)

/**
 * Drive `popup` through a platform's pages until the platform sends it to
 * Bridge's callback, after which Callback and Prover take over. Leaving the
 * platform for anywhere else is not a return: the driver keeps waiting, and
 * fails on its budget naming the page it stopped on.
 */
export async function drivePopup(popup: Page, driver: Driver) {
  const deadline = Date.now() + BUDGET_MS
  const watch = watchReturn(popup)
  const returned = () => watch.returned || (!popup.isClosed() && isCallback(popup.url()))
  const pause: Pause = async (ms, reason) => {
    if (Date.now() + ms > deadline)
      throw new Error(
        `${reason}; waiting ${ms / 1000} s more would pass the ${BUDGET_MS / 1000} s budget`,
      )
    await sleep(ms)
  }
  /**
   * `work`'s value, or LATE once the budget runs out first: late work is left
   * behind, its rejection handled.
   */
  const withinBudget = async <T>(work: Promise<T>): Promise<T | typeof LATE> => {
    work.catch(() => {})
    const budget = new AbortController()
    return Promise.race([
      work,
      sleep(Math.max(0, deadline - Date.now()), LATE, { signal: budget.signal }).catch(
        (): typeof LATE => LATE,
      ),
    ]).finally(() => budget.abort())
  }
  while (Date.now() < deadline) {
    if (returned()) return
    const failed = await withinBudget(failures.get(popup)?.() ?? Promise.resolve(undefined))
    if (failed === LATE) break
    if (failed)
      throw new Error(`The app's run failed during the ${driver.name} authorization: ${failed}`)
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
      // A step that outlasts the budget is left behind: the error names the page.
      if ((await withinBudget(driver.step(url, text, pause))) === LATE) break
    }
    await sleep(250)
  }
  if (returned()) return
  throw new Error(
    `No ${driver.name} authorization in ${BUDGET_MS / 1000} s; stopped on ${popup.url()}`,
  )
}

/** Evaluate `expression` in `popup`, or `fallback` when it fails or takes over 5 s. */
export function evaluateWithin<T>(popup: Page, expression: string, fallback: T): Promise<T> {
  const timer = new AbortController()
  return Promise.race([
    popup.evaluate<T>(expression).catch(() => fallback),
    sleep(5_000, fallback, { signal: timer.signal }).catch(() => fallback),
  ]).finally(() => timer.abort())
}

/**
 * Evaluate `find`, a page expression for the control to press or nothing,
 * then click that control for real. Returns whether there was one.
 */
export async function clickFound(popup: Page, find: string): Promise<boolean> {
  const mark = `(() => {
  document.querySelectorAll('[data-libid-click]').forEach(e => e.removeAttribute('data-libid-click'));
  const target = ${find};
  if (!target) return false;
  target.setAttribute('data-libid-click', '1');
  return true;
})()`
  if (!(await evaluateWithin(popup, mark, false))) return false
  await popup
    .locator('[data-libid-click="1"]')
    .click({ timeout: 5_000 })
    .catch(() => {})
  return true
}
