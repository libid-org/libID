import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CARRIER_CLAIM_TIMEOUT_MS,
  CLAIM,
  decodeKeeperRequest,
  KEEP,
  KEEPER_REPLY_TIMEOUT_MS,
  PortKeeper,
} from './keeper.js'
import { CONNECTION_VERSION } from './port.js'
import { fakeScope, ID, OTHER_ID, tick } from './testing/fakes.js'

const nextMessage = (port: MessagePort): Promise<unknown> =>
  new Promise((resolve) => {
    port.onmessage = (e) => resolve(e.data)
  })

describe('PortKeeper [POPUP-KEEPER-001/004]', () => {
  it('keeps then claims the same entangled port, preserving queued messages', async () => {
    const scope = fakeScope()
    const source = new PortKeeper(scope.worker)
    const destination = new PortKeeper(scope.worker)
    const channel = new MessageChannel()

    await source.keep(ID, channel.port1)
    expect(scope.pending).toHaveLength(1)
    // Posted while the worker owns the port: arrives after the claim.
    channel.port2.postMessage({ type: 'queued' })

    const claimed = await destination.claim(ID)
    expect(claimed).not.toBeNull()
    const pending = nextMessage(claimed as MessagePort)
    await tick()
    expect(await pending).toEqual({ type: 'queued' })
    // One-use: the entry is gone.
    expect(await destination.claim(ID)).toBeNull()
    await expect(scope.pending[0]).resolves.toBeUndefined()
  })

  it('returns null for an unknown id without touching anything', async () => {
    const scope = fakeScope()
    expect(await new PortKeeper(scope.worker).claim(ID)).toBeNull()
    expect(scope.pending).toHaveLength(0)
  })
})

describe('worker validation [POPUP-KEEPER-002]', () => {
  it('rejects a duplicate keep for a live id and closes both ports', async () => {
    const scope = fakeScope()
    const keeper = new PortKeeper(scope.worker)
    const first = new MessageChannel()
    const second = new MessageChannel()
    await keeper.keep(ID, first.port1)
    await expect(keeper.keep(ID, second.port1)).rejects.toThrow('keep-failed')
    expect(await keeper.claim(ID)).toBeNull()
    await expect(scope.pending[0]).resolves.toBeUndefined()
  })

  it(
    'ignores a client from another origin',
    async () => {
      const scope = fakeScope()
      const foreign = new PortKeeper(scope.foreignWorker)
      await expect(foreign.claim(ID)).rejects.toThrow('claim-failed')
    },
    KEEPER_REPLY_TIMEOUT_MS + 500,
  )

  it('decodes exact requests only', () => {
    const ok = { type: KEEP, connectionVersion: CONNECTION_VERSION, connectionId: ID }
    expect(decodeKeeperRequest(ok)).toEqual(ok)
    expect(decodeKeeperRequest({ ...ok, type: CLAIM })?.type).toBe(CLAIM)
    for (const bad of [
      { ...ok, connectionVersion: 2 },
      { ...ok, connectionId: ID.toUpperCase() },
      { ...ok, extra: 1 },
      { ...ok, type: 'other' },
      null,
      'keep',
    ]) {
      expect(decodeKeeperRequest(bad)).toBeNull()
    }
  })

  it('rejects malformed keep and claim reply shapes', async () => {
    const worker = {
      postMessage(_message: unknown, transfer: Transferable[]) {
        const reply = transfer[transfer.length - 1] as MessagePort
        reply.postMessage({ port: 'yes' })
      },
    }
    const keeper = new PortKeeper(worker)
    await expect(keeper.claim(ID)).rejects.toThrow('claim-failed')
    await expect(keeper.keep(ID, new MessageChannel().port1)).rejects.toThrow('keep-failed')
  })

  it('keeps ids isolated', async () => {
    const scope = fakeScope()
    const keeper = new PortKeeper(scope.worker)
    await keeper.keep(ID, new MessageChannel().port1)
    expect(await keeper.claim(OTHER_ID)).toBeNull()
    expect(await keeper.claim(ID)).not.toBeNull()
  })
})

describe('expiry [POPUP-KEEPER-003]', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('deletes the entry at the deadline; a later claim is absent', async () => {
    const scope = fakeScope()
    const keeper = new PortKeeper(scope.worker)
    const channel = new MessageChannel()
    const kept = keeper.keep(ID, channel.port1)
    await vi.advanceTimersByTimeAsync(10)
    await kept
    await vi.advanceTimersByTimeAsync(CARRIER_CLAIM_TIMEOUT_MS + 1)
    await expect(scope.pending[0]).resolves.toBeUndefined()
    const claim = keeper.claim(ID)
    await vi.advanceTimersByTimeAsync(10)
    expect(await claim).toBeNull()
  })
})
