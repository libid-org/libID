import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { startPrefetch } from './prefetch.js'

vi.hoisted(() => vi.stubGlobal('document', {}))
afterAll(() => vi.unstubAllGlobals())
const { connection, rootWorker, dispatchPrefetch } = vi.hoisted(() => ({
  connection: { ready: Promise.resolve(), send: vi.fn() },
  rootWorker: vi.fn(),
  dispatchPrefetch: vi.fn(),
}))
vi.mock('virtual:ceremony-assets', () => ({ requestsByProfile: { 'google/1': [] } }))
vi.mock('virtual:ceremony-popup-fallback', () => ({ fallback: undefined }))
vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept: () => connection },
  PopupWindow: { current: vi.fn() },
}))
vi.mock('../../assets/registration.js', () => ({ rootWorker, dispatchPrefetch }))
vi.mock('../../assets/worker.js', () => ({ startWorker: vi.fn() }))
vi.mock('./ui.js', () => ({ eventView: () => ({ stop: vi.fn() }) }))
const fragment = new URLSearchParams({
  ceremonyId: '6e171568-54e1-4f0d-aeb5-e8859826476a',
  platformId: 'google',
  ceremonyVersion: '1',
}).toString()
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
it('permits OAuth only after authenticated worker dispatch [CSP-013]', async () => {
  let elapsed = 25
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  let ready!: () => void, activated!: () => void, dispatched!: () => void
  connection.ready = new Promise<void>((resolve) => {
    ready = resolve
  })
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
  const run = startPrefetch(fragment)
  expect(connection.send).not.toHaveBeenCalled()
  expect(rootWorker).not.toHaveBeenCalled()
  elapsed = 2025
  ready()
  await vi.waitFor(() => expect(rootWorker).toHaveBeenCalledOnce())
  expect(dispatchPrefetch).not.toHaveBeenCalled()
  elapsed = 2100
  activated()
  await vi.waitFor(() => expect(dispatchPrefetch).toHaveBeenCalledOnce())
  expect(connection.send).not.toHaveBeenCalled()
  elapsed = 2130
  dispatched()
  await run
  expect(connection.send).toHaveBeenCalledExactlyOnceWith({
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
  })
})
it('a failed mandatory readiness send reports failure instead of silently continuing', async () => {
  connection.send.mockImplementationOnce(() => {
    throw new Error('send failed')
  })
  await startPrefetch(fragment)
  expect(dispatchPrefetch).toHaveBeenCalledOnce()
  expect(connection.send).toHaveBeenLastCalledWith({
    type: 'ceremony-failed',
    event: 'prefetch-dispatch',
    message: 'send failed',
  })
})
