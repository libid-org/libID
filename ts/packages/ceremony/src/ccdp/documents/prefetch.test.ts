import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, type FakeDocumentUi, fakeDocumentUi } from '../../testing/index.js'
import { messages } from '../ui-messages.js'
import { startPrefetch } from './prefetch.js'

vi.hoisted(() => vi.stubGlobal('document', {}))
afterAll(() => vi.unstubAllGlobals())
const { rootWorker, dispatchPrefetch } = vi.hoisted(() => ({
  rootWorker: vi.fn(),
  dispatchPrefetch: vi.fn(),
}))
vi.mock('virtual:ceremony-assets', () => ({ requestsByProfile: { 'google/1': [] } }))
vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept: () => connection },
  PopupWindow: { current: vi.fn() },
}))
vi.mock('../../assets/registration.js', () => ({ rootWorker, dispatchPrefetch }))
vi.mock('../../assets/worker.js', () => ({ startWorker: vi.fn() }))
vi.mock('./ui.js', async () => (await import('../../testing/index.js')).documentUi(() => ui))
let connection: FakeConnection, ui: FakeDocumentUi
const fragment = (platformId = 'google') =>
  new URLSearchParams({ ceremonyId: CEREMONY_ID, platformId, ceremonyVersion: '1' }).toString()
beforeEach(() => {
  connection = fakeConnection({ peerOrigin: 'https://app.test' })
  ui = fakeDocumentUi()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
it('permits OAuth only after authenticated worker dispatch [CSP-013]', async () => {
  let elapsed = 25
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  let activated!: () => void, dispatched!: () => void
  connection = fakeConnection({ peerOrigin: 'https://app.test', ready: 'pending' })
  rootWorker.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      activated = resolve
    }),
  )
  dispatchPrefetch.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      dispatched = resolve
    }),
  )
  const run = startPrefetch(fragment())
  expect(connection.sent).toEqual([])
  expect(rootWorker).not.toHaveBeenCalled()
  elapsed = 2025
  connection.settle()
  await vi.waitFor(() => expect(rootWorker).toHaveBeenCalledOnce())
  expect(dispatchPrefetch).not.toHaveBeenCalled()
  elapsed = 2100
  activated()
  await vi.waitFor(() => expect(dispatchPrefetch).toHaveBeenCalledOnce())
  expect(connection.sent).toEqual([])
  elapsed = 2130
  dispatched()
  await run
  expect(connection.sent).toEqual([
    {
      type: 'event',
      event: 'prefetch-dispatch',
      phase: 'finished',
      timestamp: performance.timeOrigin + 2130,
      instrumentation: {
        attributes: {
          'document-startup-ms': 25,
          'connection-ms': 2000,
          'worker-ready-ms': 75,
          'dispatch-ms': 30,
        },
      },
    },
  ])
})
it('a failed mandatory readiness send reports failure instead of silently continuing', async () => {
  vi.spyOn(connection, 'send').mockImplementationOnce(() => {
    throw new Error('send failed')
  })
  await startPrefetch(fragment())
  expect(dispatchPrefetch).toHaveBeenCalledOnce()
  expect(connection.sent).toEqual([
    { type: 'ceremony-failed', event: 'prefetch-dispatch', message: 'send failed' },
  ])
})
it('rejects a profile without bundled requests before accepting a connection', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stop = vi.spyOn(ui, 'stop')
  await startPrefetch(fragment('x'))
  expect(rootWorker).not.toHaveBeenCalled()
  expect(connection.sent).toEqual([])
  expect(ui.events).toEqual([
    expect.objectContaining({ status: 'failed', message: messages.unsupportedProfile }),
  ])
  expect(stop).toHaveBeenCalledOnce()
  expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
})
