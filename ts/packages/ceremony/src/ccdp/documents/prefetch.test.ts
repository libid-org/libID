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
vi.mock('@libid/popup', () => ({
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
afterEach(() => vi.clearAllMocks())
it('permits OAuth only after authenticated worker dispatch [CSP-013]', async () => {
  let ready!: () => void, dispatched!: () => void
  connection.ready = new Promise<void>((resolve) => {
    ready = resolve
  })
  dispatchPrefetch.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      dispatched = resolve
    }),
  )
  const run = startPrefetch(fragment)
  expect(connection.send).not.toHaveBeenCalled()
  ready()
  await vi.waitFor(() => expect(dispatchPrefetch).toHaveBeenCalledOnce())
  expect(connection.send).not.toHaveBeenCalled()
  dispatched()
  await run
  expect(connection.send).toHaveBeenCalledExactlyOnceWith({
    type: 'event',
    event: 'prefetch-dispatch',
    phase: 'finished',
    timestamp: expect.any(Number),
  })
})
it('a failed mandatory readiness send reports failure instead of silently continuing', async () => {
  connection.send.mockImplementationOnce(() => {
    throw new Error('send failed')
  })
  await startPrefetch(fragment)
  expect(dispatchPrefetch).toHaveBeenCalledOnce()
  expect(connection.send).toHaveBeenLastCalledWith({
    type: 'abort',
    event: 'prefetch-dispatch',
    message: 'send failed',
  })
})
