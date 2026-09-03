// Real-browser qualification of the popup connection: scripted and
// native-anchor creation, opener authentication, connected navigation into
// and out of a COOP-isolated document over one preserved port, port expiry
// across a non-participating hop, and control after the opener is severed.

import { expect, type Page, test } from '@playwright/test'

const APP_A = 'https://app-a.lvh.me:4581'
const APP_B = 'https://app-b.local.gd:4582'
const POPUP = 'https://popup.localtest.me:4583'
const POPUP_B = 'https://popup-b.lvh.me:4584'

const freshId = () => crypto.randomUUID()

interface Pong {
  type: 'pong'
  n: number
  path: string
  isolated: boolean
}

const events = (page: Page) =>
  page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)
const diag = (page: Page) => page.evaluate(() => (window as unknown as { __diag: string[] }).__diag)

/** Arm the application page and click its anchor for one connection id. */
async function open(
  page: Page,
  options: { app?: string; id?: string; href?: string; blocked?: boolean; rel?: string } = {},
): Promise<{ id: string; popup: Page }> {
  const id = options.id ?? freshId()
  await page.goto(options.app ?? APP_A)
  await page.evaluate(
    ([id, href, blocked, rel]) => {
      const w = window as unknown as { __id: string; open: unknown }
      w.__id = id
      const anchor = document.getElementById('go') as HTMLAnchorElement
      anchor.href = href
      if (rel) anchor.rel = rel
      if (blocked) w.open = () => null
    },
    [
      id,
      options.href ?? `${POPUP}/p#c=${id}`,
      options.blocked ?? false,
      options.rel ?? '',
    ] as const,
  )
  const popupPromise = page.context().waitForEvent('page')
  await page.click('#go')
  return { id, popup: await popupPromise }
}

const ping = (page: Page, n: number) =>
  page.evaluate((n) => {
    ;(window as unknown as { __conn: { send(v: unknown): void } }).__conn.send({ type: 'ping', n })
  }, n)

const navigateAway = (page: Page, url: string) =>
  page.evaluate(
    (url) =>
      (
        window as unknown as { __conn: { navigateAway(u: string): Promise<void> } }
      ).__conn.navigateAway(url),
    url,
  )

const navigate = (page: Page, url: string) =>
  page.evaluate(
    (url) =>
      (window as unknown as { __conn: { navigate(u: string): Promise<void> } }).__conn.navigate(
        url,
      ),
    url,
  )

/** Run an action that replaces the popup document and wait for the new one. */
async function nextDocument(
  popup: Page,
  action: () => Promise<unknown> = async () => {},
): Promise<void> {
  const before = await popup.evaluate(() => performance.timeOrigin)
  await action()
  await expect
    .poll(() => popup.evaluate(() => performance.timeOrigin).catch(() => before), {
      timeout: 15_000,
    })
    .not.toBe(before)
}

async function expectPong(page: Page, n: number): Promise<Pong> {
  await expect
    .poll(async () =>
      (await events(page)).filter((e) => (e as Pong).n === n && (e as Pong).type === 'pong'),
    )
    .toHaveLength(1)
  return (await events(page)).find((e) => (e as Pong).n === n) as Pong
}

test('[POPUP-WINDOW-001] [POPUP-PORT-001] scripted open connects over MessagePort', async ({
  page,
}) => {
  const { popup } = await open(page)
  await expect(popup.locator('#status')).toHaveText('connected')
  await expectPong(page, 0)
  await ping(page, 1)
  expect(await expectPong(page, 1)).toMatchObject({ path: '/p', isolated: false })
  expect(await diag(page)).toEqual(['window-opened', 'control-direct', 'carrier-message-port'])
  expect(await diag(popup)).toEqual(['carrier-message-port'])
})

test('[POPUP-WINDOW-002] blocked scripted open binds the native anchor popup', async ({ page }) => {
  const { popup } = await open(page, { blocked: true })
  await expect(popup.locator('#status')).toHaveText('connected')
  await ping(page, 1)
  await expectPong(page, 1)
  expect(await diag(page)).toEqual(['window-blocked', 'window-bound', 'carrier-message-port'])
  expect(
    await page.evaluate(
      () => (window as unknown as { __popupWindow: { opened: boolean } }).__popupWindow.opened,
    ),
  ).toBe(true)
})

test('[POPUP-WINDOW-003] a noopener anchor never binds and the popup fails closed', async ({
  page,
}) => {
  const { popup } = await open(page, { blocked: true, rel: 'noopener' })
  await expect(popup.locator('#status')).toHaveText('failed: fallback-unavailable')
  expect(await diag(popup)).toEqual(['fallback-unavailable', 'connection-failed'])
  await page.waitForTimeout(300)
  expect(await diag(page)).toEqual(['window-blocked'])
})

test('[POPUP-CONNECTION-001] an unlisted application origin is rejected by the popup', async ({
  page,
}) => {
  const { popup } = await open(page, { app: APP_B })
  await expect(popup.locator('#status')).toHaveText('failed: handshake-rejected')
  await page.waitForTimeout(300)
  expect(await diag(page)).toEqual(['window-opened', 'control-direct'])
})

test('[POPUP-CONTROL-002] [POPUP-CONNECTION-003] [POPUP-KEEPER-003] one port survives app-driven navigation into and out of isolation', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  // Let the first document's registration activate before navigating.
  await popup.evaluate(() => navigator.serviceWorker.ready)

  await nextDocument(popup, () => navigate(page, `${POPUP}/isolated#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await popup.evaluate(() => crossOriginIsolated)).toBe(true)
  expect(await diag(popup)).toEqual(['carrier-restored'])
  await ping(page, 2)
  expect(await expectPong(page, 2)).toMatchObject({ path: '/isolated', isolated: true })
  // B2 qualification: the COOP switch makes the retained handle report closed.
  expect(
    await page.evaluate(() => (window as unknown as { __handle: Window }).__handle.closed),
  ).toBe(true)

  await nextDocument(popup, () => navigate(page, `${POPUP}/p#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await diag(popup)).toEqual(['carrier-restored'])
  await ping(page, 3)
  expect(await expectPong(page, 3)).toMatchObject({ path: '/p', isolated: false })

  const appDiag = await diag(page)
  expect(appDiag.filter((c) => c === 'carrier-message-port')).toHaveLength(1)
  expect(appDiag.filter((c) => c === 'control-connected')).toHaveLength(2)
  expect(appDiag).not.toContain('fallback-unavailable')
})

test('[POPUP-CONTROL-003] [POPUP-CONTROL-004] close reaches a severed popup over the port', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  await nextDocument(popup, () => navigate(page, `${POPUP}/isolated#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('connected')
  const closed = popup.waitForEvent('close')
  await page.evaluate(() =>
    (window as unknown as { __conn: { close(): Promise<void> } }).__conn.close(),
  )
  await closed
  expect(await diag(page)).toContain('connection-closed')
})

test('[POPUP-CONTROL-001] close uses the live handle directly', async ({ page }) => {
  const { popup } = await open(page)
  await expectPong(page, 0)
  const closed = popup.waitForEvent('close')
  await page.evaluate(() =>
    (window as unknown as { __conn: { close(): Promise<void> } }).__conn.close(),
  )
  await closed
})

test('[POPUP-CONNECTION-008] popup-initiated navigation preserves the port', async ({ page }) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  await nextDocument(popup, () =>
    page.evaluate(
      (url) =>
        (window as unknown as { __conn: { send(v: unknown): void } }).__conn.send({
          type: 'go',
          url,
        }),
      `${POPUP}/isolated#c=${id}`,
    ),
  )
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await diag(popup)).toEqual(['carrier-restored'])
  await ping(page, 4)
  expect(await expectPong(page, 4)).toMatchObject({ path: '/isolated', isolated: true })
})

test('[POPUP-KEEPER-003] [POPUP-CONNECTION-003] a long non-participating hop expires the port; the next document re-establishes', async ({
  page,
}) => {
  test.slow()
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  const next = encodeURIComponent(`${POPUP}/p#c=${id}`)
  await nextDocument(popup, () => navigate(page, `${POPUP}/external?delay=5500&next=${next}`))
  await expect(popup.locator('#status')).toHaveText('external')
  await nextDocument(popup)
  await expect(popup.locator('#status')).toHaveText('connected')
  // Expired in the worker: the fresh document found nothing and used its opener.
  expect(await diag(popup)).toEqual(['claim-empty', 'carrier-message-port'])
  await ping(page, 5)
  expect(await expectPong(page, 5)).toMatchObject({ path: '/p' })
  expect((await diag(page)).filter((c) => c === 'carrier-message-port')).toHaveLength(2)
})

test('[POPUP-KEEPER-003] a short non-participating hop keeps the port', async ({ page }) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  const next = encodeURIComponent(`${POPUP}/p#c=${id}`)
  await nextDocument(popup, () => navigate(page, `${POPUP}/external?delay=200&next=${next}`))
  await nextDocument(popup)
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await diag(popup)).toEqual(['carrier-restored'])
  await ping(page, 6)
  await expectPong(page, 6)
})

test('[POPUP-CONNECTION-002] [POPUP-CONNECTION-005] direct navigation into isolation without a carrier fails closed', async ({
  page,
}) => {
  const id = freshId()
  const { popup } = await open(page, { id, href: `${POPUP}/isolated#c=${id}` })
  await expect(popup.locator('#status')).toHaveText('failed: fallback-unavailable')
  expect(await diag(popup)).toEqual(['fallback-unavailable', 'connection-failed'])
  await page.waitForTimeout(300)
  expect(await diag(page)).toEqual(['window-opened', 'control-direct'])
})

test('[POPUP-CONTROL-002] malformed navigation fails before any browser operation', async ({
  page,
}) => {
  const { popup } = await open(page)
  await expectPong(page, 0)
  for (const bad of [
    'http://popup.localtest.me:4583/p',
    '/p',
    'https://u:p@popup.localtest.me:4583/p',
  ]) {
    await expect(navigate(page, bad)).rejects.toThrow()
  }
  expect(popup.url()).toContain('/p#')
  expect((await diag(page)).filter((c) => c === 'control-rejected')).toHaveLength(3)
})

test('[POPUP-CONNECTION-008] [POPUP-CONNECTION-009] a cross-site participating hop re-handshakes over the opener', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)

  await nextDocument(popup, () => navigate(page, `${POPUP_B}/p#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(popup.url()).toContain(POPUP_B)
  // No registration on the new origin yet: no claim, a fresh opener handshake.
  expect(await diag(popup)).toEqual(['carrier-message-port'])
  await ping(page, 7)
  expect(await expectPong(page, 7)).toMatchObject({ path: '/p' })

  // Back to the first origin: its worker holds nothing for this id.
  await nextDocument(popup, () => navigate(page, `${POPUP}/p#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await diag(popup)).toEqual(['claim-empty', 'carrier-message-port'])
  await ping(page, 8)
  await expectPong(page, 8)
  expect((await diag(page)).filter((c) => c === 'carrier-message-port')).toHaveLength(3)
})

test('[POPUP-CONNECTION-008] a cross-site isolated destination needs a fallback', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  await nextDocument(popup, () => navigate(page, `${POPUP_B}/isolated#c=${id}`))
  await expect(popup.locator('#status')).toHaveText('failed: fallback-unavailable')
  expect(await diag(popup)).toEqual(['fallback-unavailable', 'connection-failed'])
})

test('[POPUP-CONTROL-005] navigateAway leaves for a provider page directly and the return re-handshakes', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  const next = encodeURIComponent(`${POPUP}/p#c=${id}`)
  await nextDocument(popup, () => navigateAway(page, `${POPUP}/external?delay=200&next=${next}`))
  expect((await diag(page)).at(-1)).toBe('control-direct')
  await nextDocument(popup)
  await expect(popup.locator('#status')).toHaveText('connected')
  // Nothing was kept: the returning document found no port and used its opener.
  expect(await diag(popup)).toEqual(['claim-empty', 'carrier-message-port'])
  await ping(page, 9)
  await expectPong(page, 9)
  expect((await diag(page)).filter((c) => c === 'carrier-message-port')).toHaveLength(2)
})

test('[POPUP-CONTROL-005] popup-side navigateAway keeps no port', async ({ page }) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  await popup.evaluate(() => navigator.serviceWorker.ready)
  const next = encodeURIComponent(`${POPUP}/p#c=${id}`)
  await nextDocument(popup, () =>
    page.evaluate(
      (url) =>
        (window as unknown as { __conn: { send(v: unknown): void } }).__conn.send({
          type: 'away',
          url,
        }),
      `${POPUP}/external?delay=200&next=${next}`,
    ),
  )
  await nextDocument(popup)
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(await diag(popup)).toEqual(['claim-empty', 'carrier-message-port'])
})

test("[POPUP-CONNECTION-009] a popup deployed with '*' accepts an unlisted application origin", async ({
  page,
}) => {
  const id = freshId()
  const { popup } = await open(page, { app: APP_B, id, href: `${POPUP}/p-any#c=${id}` })
  await expect(popup.locator('#status')).toHaveText('connected')
  await ping(page, 10)
  await expectPong(page, 10)
  expect(await diag(popup)).toEqual(['carrier-message-port'])
})

test('[POPUP-CONNECTION-010] a reply sent before navigate reaches the popup before it leaves cross-site', async ({
  page,
}) => {
  const { id, popup } = await open(page)
  await expectPong(page, 0)
  // Application-driven transition: on the popup's message, reply first, then
  // navigate the popup to another site. The reply and the control share one
  // ordered port, so the popup answers the reply before it leaves.
  await page.evaluate(
    ([url]) => {
      const w = window as unknown as {
        __onPong?: (pong: { n: number }) => void
        __conn: { send(v: unknown): void; navigate(u: string): Promise<void> }
      }
      w.__onPong = (pong) => {
        if (pong.n !== 1) return
        w.__conn.send({ type: 'ping', n: 42 })
        void w.__conn.navigate(url)
      }
    },
    [`${POPUP_B}/p#c=${id}`],
  )
  await nextDocument(popup, () => ping(page, 1))
  // The popup replied to ping 42 from the first document before it left.
  expect(await expectPong(page, 42)).toMatchObject({ path: '/p' })
  await expect(popup.locator('#status')).toHaveText('connected')
  expect(popup.url()).toContain(POPUP_B)
  expect(await diag(popup)).toEqual(['carrier-message-port'])
})
