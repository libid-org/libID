import { once } from 'node:events'
import { connect, createServer, type Socket } from 'node:net'
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

for (const stall of ['send', 'reveal'] as const)
  test(`notary ${stall} timeout closes real sockets and workers [LIBID-BROWSER-010]`, async ({
    page,
  }) => {
    // Pass through real setup, then withhold replies. Keep the page and relay alive
    // while asserting cleanup so test teardown cannot make a leaked socket pass.
    let stalled = false
    const sockets = new Set<Socket>()
    const relay = createServer((client) => {
      const upstream = connect(4987, '127.0.0.1')
      sockets.add(client).add(upstream)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.on('close', () => {
        sockets.delete(client)
        upstream.destroy()
      })
      upstream.on('close', () => {
        sockets.delete(upstream)
        client.destroy()
      })
      client.pipe(upstream)
      upstream.on('data', (data) => {
        if (!stalled) client.write(data)
      })
    })
    const listening = once(relay, 'listening')
    relay.listen(0, '127.0.0.1')
    await listening
    try {
      const address = relay.address()
      if (!address || typeof address === 'string') throw new Error('Missing relay port')
      const runtime = await page.evaluateHandle(async (notaryAddress) => {
        const abort = new AbortController()
        const notary = new window.Notarization(notaryAddress, abort.signal)
        const request = {
          url: 'https://api.x.com/2/users/me',
          method: 'GET' as const,
          headers: {
            Host: new TextEncoder().encode('api.x.com'),
            Connection: new TextEncoder().encode('close'),
          },
          body: new Uint8Array(),
        }
        const sessions = await Promise.all([
          notary.prepare(request.url),
          notary.prepare(request.url),
        ])
        return {
          abort,
          notary,
          sessions,
          request,
          transcripts: [] as { sent: Uint8Array; received: Uint8Array }[],
        }
      }, `http://127.0.0.1:${address.port}`)
      try {
        expect(sockets.size).toBe(4)
        expect(page.workers().length).toBeGreaterThan(0)
        if (stall === 'reveal')
          await runtime.evaluate(async (state) => {
            state.transcripts = await Promise.all(state.sessions.map((s) => s.send(state.request)))
          })
        stalled = true
        const outcome = await runtime.evaluate(async (state, stall) => {
          const results = await Promise.allSettled(
            state.sessions.map(async (session, i) => {
              if (stall === 'send') return session.send(state.request)
              const transcript = state.transcripts[i]
              const revealed = await session.reveal({
                sent: [{ start: 0, end: transcript.sent.length }],
                received: [{ start: 0, end: transcript.received.length }],
              })
              return revealed.attestation
            }),
          )
          return {
            aborted: state.notary.signal.aborted,
            results: results.map((r) =>
              r.status === 'rejected' ? r.reason.message : 'unexpected success',
            ),
          }
        }, stall)
        expect(outcome).toEqual({
          aborted: true,
          results: ['Notarization request timed out', 'Notarization request timed out'],
        })
        await expect.poll(() => sockets.size, { timeout: 5000 }).toBe(0)
        await expect.poll(() => page.workers().length, { timeout: 5000 }).toBe(0)
      } finally {
        await runtime.evaluate(({ abort }) => abort.abort()).catch(() => {})
        await runtime.dispose()
      }
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => relay.close(() => resolve()))
    }
  })
