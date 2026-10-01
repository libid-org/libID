import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, type FakeDocumentUi, fakeDocumentUi } from '../../testing/index.js'
import { messages } from '../uiMessages.js'
import { startPrefetch } from './prefetch.js'

vi.hoisted(() => vi.stubGlobal('document', {}))
afterAll(() => vi.unstubAllGlobals())
const { registerRootWorker, dispatchPrefetch } = vi.hoisted(() => ({
  registerRootWorker: vi.fn(),
  dispatchPrefetch: vi.fn(),
}))
vi.mock('virtual:ceremony-assets', () => ({ requestsByProfile: { 'google/1': [] } }))
vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept: () => connection },
  PopupWindow: { current: vi.fn() },
}))
vi.mock('../../assets/registration.js', () => ({ registerRootWorker, dispatchPrefetch }))
vi.mock('./ui.js', async () => (await import('../../testing/index.js')).documentUi(() => ui))
let connection: FakeConnection
let ui: FakeDocumentUi
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
  let activated!: () => void
  let dispatched!: () => void
  connection = fakeConnection({ peerOrigin: 'https://app.test', ready: 'pending' })
  registerRootWorker.mockReturnValueOnce(
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
  expect(registerRootWorker).not.toHaveBeenCalled()
  elapsed = 2025
  connection.settle()
  await vi.waitFor(() => expect(registerRootWorker).toHaveBeenCalledOnce())
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
it('tells the Application a profile without bundled requests is unsupported, starting no worker', async () => {
  const stop = vi.spyOn(ui, 'stop')
  await startPrefetch(fragment('x'))
  expect(registerRootWorker).not.toHaveBeenCalled()
  expect(connection.sent).toEqual([
    { type: 'ceremony-failed', event: 'prefetch-dispatch', message: messages.unsupportedProfile },
  ])
  expect(ui.events).toContainEqual(
    expect.objectContaining({ status: 'failed', message: messages.unsupportedProfile }),
  )
  expect(stop).toHaveBeenCalledOnce()
})
