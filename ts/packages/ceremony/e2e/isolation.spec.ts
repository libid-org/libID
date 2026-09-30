// Connections, origins and windows that must not stand in for one another.
import { describePopup, expect, test } from './fixtures.js'

test('two independently supplied connections cannot replace each other [LIBID-BROWSER-014]', async ({
  app,
  bridge,
  page,
  context,
  googleProvider,
}) => {
  const states = new Set<string>()
  await googleProvider((state) => {
    states.add(state)
    return `${bridge}/auth/callback#error=access_denied&state=${state}`
  })
  await page.goto(app)
  await page.waitForFunction(() => window.ready)
  // Both launches start before either popup opens.
  await page.locator('#launch').click()
  await page.locator('#launch').click()
  try {
    await expect.poll(() => page.evaluate(() => window.completed.length)).toBe(2)
  } catch (error) {
    console.log(
      'Concurrent ceremony failure',
      JSON.stringify({
        states: states.size,
        runs: await page.evaluate(() => window.runs),
        popups: await Promise.all(
          context
            .pages()
            .filter((popup) => popup !== page)
            .map(describePopup),
        ),
      }),
    )
    throw error
  }
  expect(states.size).toBe(2)
  expect(await page.evaluate(() => window.completed)).toEqual([
    { status: 'denied' },
    { status: 'denied' },
  ])
})

test('Prover rejects a changed Application origin in the same opener window [TEST-CCDP-04] [TEST-COMMON-14] [LIBID-OAUTH-017]', async ({
  ccdp,
  page,
  context,
  googleProvider,
  launch,
}) => {
  await googleProvider()
  // A second origin admitted by Callback's deployment. The retained WindowProxy
  // is unchanged, but this new document is not the Application Callback bound.
  await context.route(`${ccdp}/changed-application`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>
      window.addEventListener('message', event => {
        if (event.data?.type !== 'message-port') return
        const channel = new MessageChannel()
        event.source.postMessage(event.data, event.origin, [channel.port2])
      })
    </script>`,
    }),
  )
  await context.route(`${ccdp}/ccdp/v1/prover`, async (route) => {
    // Callback already authenticated and constructed the private fragment.
    await page.goto(`${ccdp}/changed-application`)
    await route.continue()
  })
  const popup = await launch()
  await expect(popup.locator('body')).toContainText('connection failed authentication')
  expect(await popup.evaluate(() => location.hash)).toBe('')
  expect(new URL(page.url()).origin).toBe(ccdp)
})

test('provider isolation ends Application and returning Callback reports its own connection failure [TEST-CCDP-08] [LIBID-BROWSER-005] [LIBID-OAUTH-020] [LIBID-BROWSER-009]', async ({
  bridge,
  page,
  googleProvider,
  launch,
}) => {
  // Serve COOP over HTTP: WebKit does not apply it to the intercepted response.
  await googleProvider((state) => `${bridge}/isolating-provider?state=${encodeURIComponent(state)}`)
  const popup = await launch()
  await expect(popup.locator('#return')).toBeVisible()
  expect(await popup.evaluate(() => window.opener === null)).toBe(true)
  // Background polling may be suspended; observe from the active application.
  await page.bringToFront()
  await expect
    .poll(() => page.evaluate(() => window.ceremonyClosed))
    .toEqual({
      outcome: 'failed',
      code: 'popup-unavailable',
    })
  // Consent can continue even though Application has lost the window handle.
  expect(popup.isClosed()).toBe(false)
  await popup.locator('#return').click()
  await expect(popup.locator('[role="status"]')).toContainText(
    'Unable to reconnect to the application',
  )
  await expect(popup.locator('[role="status"]')).toContainText(
    'The sign-in provider may have isolated this window',
  )
  await expect(popup.locator('progress')).toHaveCount(0)
  await expect(popup).toHaveURL(`${bridge}/auth/callback`)
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  expect(await page.evaluate(() => window.completed)).toEqual([])
})
