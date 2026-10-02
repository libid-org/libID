import { type Carrier, PopupWindow } from '@libid/popup'
import { afterEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, ccdpClient, testnet } from '../../testing/index.js'
import { isCeremonyId } from '../navigation.js'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['https://ccdp.test', 'https://bridge.test', true],
  ['https://ccdp.test', 'https://ccdp.test', true],
  ['https://bridge.test', 'https://bridge.test', true],
  ['https://ccdp.test', 'https://untrusted.test', false],
])(
  'connect admits the configured peer and preserves composition: %s / %s [LIBID-MOD-017]',
  async (ccdpOrigin, peerOrigin, admitted) => {
    const handle = { closed: false, close: vi.fn() }
    vi.stubGlobal('window', Object.assign(new EventTarget(), { open: () => handle }))
    const popup = PopupWindow.open('left=0,top=0')
    const client = await ccdpClient({ ccdpOrigin, platforms: { google: { clientId: 'client' } } })
    let receive: (message: unknown) => void = () => {}
    const carrier: Carrier = {
      peerOrigin,
      send: vi.fn(),
      on(handler) {
        receive = handler
        return () => {}
      },
      close: vi.fn(),
    }
    const fallback = vi.fn(async (_signal: AbortSignal) => carrier)
    const onDiagnostic = vi.fn()
    // A JavaScript caller can neither widen the configuration-derived allowlist nor pick the ID.
    const options = {
      connectionId: CEREMONY_ID,
      fallback,
      onDiagnostic,
      allowedPopupOrigins: ['*'],
    }
    const connection = client.connect<{ type: 'wallet' }>(popup, options)
    expect(connection.connectionId).not.toBe(CEREMONY_ID)
    const observed = vi.fn()
    connection.on({ type: 'wallet', decode: () => ({ type: 'wallet' }) }, observed)
    try {
      if (admitted) {
        await connection.ready
        expect(connection.peerOrigin).toBe(peerOrigin)
        receive({ type: 'wallet' })
        expect(observed).toHaveBeenCalledWith({ type: 'wallet' })
        connection.send({ type: 'wallet' })
        expect(carrier.send).toHaveBeenCalledWith({ type: 'wallet' })
        expect(onDiagnostic).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'carrier-fallback' }),
        )
        expect(handle.close).not.toHaveBeenCalled()
      } else {
        await expect(connection.ready).rejects.toMatchObject({ code: 'handshake-rejected' })
        expect(observed).not.toHaveBeenCalled()
        expect(carrier.send).not.toHaveBeenCalled()
      }
    } finally {
      await connection.close()
    }
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback.mock.calls[0][0].aborted).toBe(true)
    expect(carrier.close).toHaveBeenCalledOnce()
  },
)

it('gives each connection a fresh ID, which its ceremony runs under [KIT-007] [KIT-008]', async () => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { open: () => ({ closed: false }) }))
  const client = await ccdpClient({
    ccdpOrigin: 'https://ccdp.test',
    platforms: { google: { clientId: 'client' } },
  })
  const [first, second] = [1, 2].map(() => client.connect(PopupWindow.open('left=0,top=0')))
  for (const { connectionId } of [first, second]) expect(isCeremonyId(connectionId)).toBe(true)
  expect(first.connectionId).not.toBe(second.connectionId)
  const ceremony = client.new(first, 'google', testnet, new Uint8Array(32), new Uint8Array())
  expect(new URL(ceremony.launchUrl).hash).toContain(`ceremonyId=${first.connectionId}`)
  await Promise.all([first.close(), second.close()])
})
