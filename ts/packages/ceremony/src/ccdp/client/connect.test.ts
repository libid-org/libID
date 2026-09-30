import { testnet } from '@libid/ledger/testing'
import { type Carrier, PopupWindow } from '@libid/popup'
import { afterEach, expect, it, vi } from 'vitest'
import { bundledVersions, CEREMONY_ID } from '../../testing/index.js'
import { ccdpClientFromConfig } from './client.js'
import { validateCeremonyConfig } from './config.js'

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
    const popup = PopupWindow.open('client-connect', 'left=0,top=0')
    const client = ccdpClientFromConfig(
      validateCeremonyConfig(
        { ccdpOrigin, platforms: { google: { clientId: 'client' } } },
        'https://bridge.test',
      ),
      bundledVersions,
    )
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
    // A JavaScript caller cannot widen the configuration-derived allowlist.
    const options = {
      connectionId: CEREMONY_ID,
      fallback,
      onDiagnostic,
      allowedPopupOrigins: ['*'],
    }
    const connection = client.connect<{ type: 'wallet' }>(popup, options)
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

it('runs a ceremony only under its connection ID [KIT-008]', async () => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { open: () => ({ closed: false }) }))
  const client = ccdpClientFromConfig(
    validateCeremonyConfig(
      { ccdpOrigin: 'https://ccdp.test', platforms: { google: { clientId: 'client' } } },
      'https://bridge.test',
    ),
    bundledVersions,
  )
  const connection = client.connect(PopupWindow.open('client-ids', 'left=0,top=0'), {
    connectionId: CEREMONY_ID,
  })
  const run = (id: string) =>
    client.new(connection, id, 'google', testnet, new Uint8Array(32), new Uint8Array())
  expect(() => run(crypto.randomUUID())).toThrow('Ceremony ID must be the connection ID')
  expect(run(CEREMONY_ID).launchUrl).toContain(CEREMONY_ID)
  await connection.close()
})
