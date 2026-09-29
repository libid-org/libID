import { readFileSync } from 'node:fs'
import { type BrowserContext, expect, type Locator, type Page } from '@playwright/test'
import { buildGooglePublicInputs } from '../../../packages/ceremony/src/platforms/google/1/publicInputs.js'

// Helpers for app.spec.ts: the Bridge and app, the run history, and the popup-side fixtures.

/** Globals the fixture documents below expose to the test process. */
declare global {
  interface Window {
    /** The launch fixture's connection is ready. */
    connected?: true
    /** Releases a launch fixture that waits before accepting its connection. */
    authenticate?: () => void
    /** Where the fake provider page returns to: the prover fixture for its ceremony. */
    returnUrl?: string
    /** The prover fixture's ready connection. */
    eventConnection?: { send(value: unknown): void; close(): Promise<void> }
    /** Public inputs binding the synthetic Google proof to the returned authorization nonce. */
    googlePublicInputs?: string[]
    /** The prover fixture received `prove-identity`, whose value is `proveIdentity`. */
    requested?: true
    proveIdentity?: { clientCredential: string }
  }
}

export const configUrl = 'http://localhost:4682/api/v1/ceremony/config'
// Deliberately differs from the development deployment: the Bridge selects CCDP.
export const ccdp = 'http://localhost:4684'
export const config = {
  ccdpOrigin: ccdp,
  platforms: {
    google: { clientId: '407408718192.apps.googleusercontent.com', ceremonyVersions: [1] },
    github: { clientId: 'test-client', ceremonyVersions: [2], clientCredential: 'fixture-public' },
  },
}

/** Answers the Bridge configuration request with `platforms` in place of the default set. */
export const serveBridge = (page: Page, platforms: object = config.platforms) =>
  page.route(configUrl, (route) => route.fulfill({ json: { ...config, platforms } }))

/**
 * Serves the Bridge configuration, loads the app and waits until it is ready. `blocked` makes
 * `window.open` report a blocked popup, so launches fall back to the native anchor.
 */
export async function openApp(
  page: Page,
  { platforms = config.platforms, blocked = false }: { platforms?: object; blocked?: boolean } = {},
) {
  if (blocked)
    await page.addInitScript(() => {
      window.open = () => null
    })
  await serveBridge(page, platforms)
  await page.goto('/')
  await expect(page.locator('#status')).toContainText('Ready.')
}

export const launchButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })
export const launchButtons = (page: Page) => page.locator('#platforms').getByRole('button')

/** Expects `count` launch buttons, all of them enabled. */
export async function expectLaunchesEnabled(page: Page, count: number) {
  await expect(launchButtons(page)).toHaveCount(count)
  for (const button of await launchButtons(page).all()) await expect(button).toBeEnabled()
}

/** Activates the `name` launch button by click or by pressing `key`; resolves to its popup. */
export async function launch(page: Page, name: string, key?: 'Enter' | 'Space') {
  const opened = page.waitForEvent('popup')
  const button = launchButton(page, name)
  await (key ? button.press(key) : button.click())
  return opened
}

/** Launches `name` against {@link serveCeremony}; resolves once the provider page is loaded. */
export async function launchRun(page: Page, name: string) {
  const popup = await launch(page, name)
  await waitForFixture(popup, 'returnUrl')
  const id = (await newestRun(page).getAttribute('data-ceremony-id'))!
  return { popup, id, row: page.locator(`[data-ceremony-id="${id}"]`) }
}

export const runs = (page: Page) => page.locator('#history tr')
export const newestRun = (page: Page) => runs(page).first()
export const closeButton = (row: Locator) => row.getByRole('button', { name: 'Close' })

/** Expects `row` to show a run of the platform displayed as `platform`, with `outcome`. */
export async function expectRun(row: Locator, platform: string, outcome: string) {
  await expect(row.getByRole('cell').nth(1)).toHaveText(platform)
  await expect(row.locator('.run-outcome')).toHaveText(outcome)
}

/** Closes a run from its row, expects `outcome` on it if given, then awaits popup closure. */
export async function closeRun(row: Locator, popup: Page, outcome?: string) {
  await closeButton(row).click()
  if (outcome) await expect(row.locator('.run-outcome')).toHaveText(outcome)
  await expectClosed(popup)
}

export const expectClosed = (popup: Page) => expect.poll(() => popup.isClosed()).toBe(true)

/** Closes the prover fixture's connection from inside the popup; resolves once it has closed. */
export async function closeFromPopup(popup: Page) {
  // Firefox may destroy the target before acknowledging its self-close.
  await Promise.all([
    popup.waitForEvent('close'),
    popup
      .evaluate(() => window.eventConnection!.close())
      .catch((error) => {
        expect(error.message).toContain('Target page, context or browser has been closed')
      }),
  ])
}

/** The results the app recorded, in launch order. */
export const results = (page: Page) => page.evaluate(() => [...window.results.values()])

/** One operation timing entry of the run history, by its text. */
export const timing = (page: Page, hasText: string | RegExp) =>
  page.locator('.operation-timings li').filter({ hasText })

/** The expandable attribute details of the operation timings whose summary matches `hasText`. */
export const timingDetails = (page: Page, hasText: RegExp) =>
  page.locator('.operation-timings details').filter({
    has: page.locator('summary', { hasText }),
  })

/** Expects the run history to stay unchanged while the page clock advances. */
export async function expectFrozen(page: Page) {
  const history = await page.locator('#history').textContent()
  await page.clock.runFor(2000)
  await expect(page.locator('#history')).toHaveText(history!)
}

/** Waits until the popup's fixture document defines `name`. */
export const waitForFixture = (
  popup: Page,
  name: 'connected' | 'authenticate' | 'returnUrl' | 'requested',
) => popup.waitForFunction((name) => !!window[name], name)

// Real popup transport with synthetic ceremony documents; no OAuth or proof qualification.

/** Serves the built popup package at the CCDP origin; resolves to its entry module URL. */
export async function servePopup(context: BrowserContext) {
  await context.route(`${ccdp}/popup-test/**`, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(
        new URL(
          new URL(route.request().url()).pathname.slice('/popup-test/'.length),
          import.meta.resolve('@libid/popup'),
        ),
      ),
    }),
  )
  return `${ccdp}/popup-test/index.js`
}

/**
 * A fixture document at the CCDP origin running module `script`, in which `accept()` accepts the
 * app's connection for the ceremony named by the fragment.
 */
export const fixtureDocument = (popupModule: string, title: string, script: string) =>
  `<!doctype html><title>${title}</title><script type="module">
    import { PopupConnection, PopupWindow } from '${popupModule}';
    const accept = () => PopupConnection.accept(PopupWindow.current(location.hash, { scope: '/' }), {
      connectionId: new URLSearchParams(location.hash.slice(1)).get('ceremonyId'),
      allowedApplicationOrigins: ['http://localhost:4692'],
    });
    ${script}
  </script>`

/** Answers CCDP prefetch launches with `html`. */
export const servePrefetch = (context: BrowserContext, html: string) =>
  context.route(`${ccdp}/ccdp/v1/prefetch**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  )

/**
 * Serves the ceremony fixtures: a prefetch document reporting its dispatch, fake provider pages
 * that expose their return URL, and the prover document they return to.
 */
export async function serveCeremony(context: BrowserContext) {
  const popupModule = await servePopup(context)
  await servePrefetch(
    context,
    fixtureDocument(
      popupModule,
      'Event transport fixture',
      `const connection = accept();
      await connection.ready;
      connection.send({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: performance.timeOrigin + performance.now(), instrumentation: { attributes: { 'document-startup-ms': 25, 'connection-ms': 2000, 'worker-ready-ms': 75, 'dispatch-ms': 30 } } });`,
    ),
  )
  const prover = (nonce: string | null) =>
    fixtureDocument(
      popupModule,
      'Event transport fixture',
      `const connection = accept();
      connection.on({ type: 'prove-identity', decode: value => value }, value => { window.requested = true; window.proveIdentity = value });
      await connection.ready;
      window.googlePublicInputs = ${JSON.stringify(
        nonce === null
          ? []
          : buildGooglePublicInputs(
              Uint8Array.from(Buffer.from(nonce, 'base64url')),
              { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
              { tokenExpiresAt: 42, signingKeyModulus: new Uint8Array(256) },
            ),
      )};
      window.eventConnection = connection;`,
    )
  await context.route(`${ccdp}/event-test**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: prover(new URL(route.request().url()).searchParams.get('nonce')),
    }),
  )
  await context.route(/https:\/\/(accounts\.google\.com|x\.com|github\.com)\//, (route) => {
    const params = new URL(route.request().url()).searchParams
    const id = params.get('state')!.slice(3)
    const nonce = params.get('nonce')
    const query = nonce === null ? '' : `?${new URLSearchParams({ nonce })}`
    return route.fulfill({
      contentType: 'text/html',
      body: `<script>window.returnUrl = ${JSON.stringify(`${ccdp}/event-test${query}#ceremonyId=${id}`)}</script>`,
    })
  })
}

/** Navigates a fake provider page to its prover fixture and waits for that connection. */
export async function returnToProver(popup: Page) {
  await popup.evaluate(() => location.replace(window.returnUrl!))
  await popup.waitForFunction(() => !!window.eventConnection)
}

/** A ceremony event message; `attributes` become its instrumentation. */
export const event = (
  name: string,
  phase?: 'started' | 'finished',
  timestamp?: number,
  attributes?: Record<string, number>,
) => ({
  type: 'event',
  event: name,
  ...(phase ? { phase } : {}),
  ...(timestamp === undefined ? {} : { timestamp }),
  ...(attributes ? { instrumentation: { attributes } } : {}),
})

export const identityFetchFailure = (message: string) => ({
  type: 'ceremony-failed',
  event: 'identity-fetch',
  message,
})

/** Sends `messages` from the prover fixture; untimed events carry the popup's current time. */
export const send = (popup: Page, ...messages: { type: string; timestamp?: number }[]) =>
  popup.evaluate((messages) => {
    const timestamp = performance.timeOrigin + performance.now()
    for (const message of messages)
      window.eventConnection!.send(message.type === 'event' ? { timestamp, ...message } : message)
  }, messages)

/** Delivers a synthetic Google identity proof: UI delivery only, no proof is generated. */
export const sendProof = (popup: Page) =>
  popup.evaluate(() =>
    window.eventConnection!.send({
      type: 'identity-proof',
      identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
      proof: {
        identityProof: new Uint8Array([1]),
        publicInputs: window.googlePublicInputs,
        tokenExpiresAt: 42,
        signingKeyModulus: new Uint8Array(256),
      },
    }),
  )
