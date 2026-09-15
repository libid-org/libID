import { expect, test } from './fixtures.js'
import { verifyBrowserProof } from './verify.js'

// Controlled circuit inputs and unauthenticated X/GitHub requests; no live OAuth credentials.
test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:4986/index.html')
  await page.waitForFunction(() => typeof window.proveBearerFixture === 'function')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
})

test('real bearer-link fixture proof [LIBID-PROVER-001] [LIBID-PROVER-015]', async ({ page }) => {
  test.setTimeout(480000)
  const result = await page.evaluate(() => window.proveBearerFixture())
  expect(result.runtime.sharedMemory).toBe(true)
  expect(result.runtime.effectiveThreads).toBeGreaterThan(1)
  await verifyBrowserProof('bearer_link', result)
})

for (const [platform, count] of [
  ['x', 1],
  ['x', 2],
  ['github', 2],
] as const)
  test(`real ${platform} notary: ${count} session(s) alongside proving [LIBID-PROVER-019]`, async ({
    page,
  }) => {
    test.setTimeout(480000)
    const logs: string[] = []
    page.on('console', (message) => {
      const text = message.text()
      if (/sdk-core\/src\/prover\.rs|session driver|HTTP connection error/.test(text))
        logs.push(text)
    })
    const [proof, attestations] = await page
      .evaluate(
        async ({ platform, count }) =>
          Promise.all([window.proveBearerFixture(), window.notarizeRequests(count, platform)]),
        { platform, count },
      )
      .catch((error: unknown) => {
        // These sessions contain only the synthetic, unauthenticated requests above.
        console.error('Notary runtime progress:', JSON.stringify(logs))
        throw error
      })
    await verifyBrowserProof('bearer_link', proof)
    expect(attestations).toHaveLength(count)
    for (const attestation of attestations) {
      expect(attestation.sent).toBeGreaterThan(0)
      expect(attestation.received).toBeGreaterThan(0)
      expect(attestation.attestedData).toBeGreaterThan(0)
    }
  })
