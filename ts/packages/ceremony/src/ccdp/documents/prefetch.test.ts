import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, type FakeDocumentUi, fakeDocumentUi } from '../../testing/index.js'
import { messages } from '../uiMessages.js'
import { startPrefetch } from './prefetch.js'

vi.hoisted(() => vi.stubGlobal('document', {}))
afterAll(() => vi.unstubAllGlobals())
const { registerRootWorker, dispatchPrefetch, drainJournal } = vi.hoisted(() => ({
  registerRootWorker: vi.fn(),
  dispatchPrefetch: vi.fn(),
  drainJournal: vi.fn(),
}))
vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept: () => connection },
  PopupWindow: { current: vi.fn() },
}))
vi.mock('../../assets/registration.js', () => ({
  registerRootWorker,
  dispatchPrefetch,
  drainJournal,
}))
vi.mock('./ui.js', async () => (await import('../../testing/index.js')).documentUi(() => ui))
let connection: FakeConnection
let ui: FakeDocumentUi
const fragment = (platformId = 'google') =>
  new URLSearchParams({ ceremonyId: CEREMONY_ID, platformId, ceremonyVersion: '1' }).toString()
beforeEach(() => {
  registerRootWorker.mockResolvedValue(undefined)
  drainJournal.mockResolvedValue([])
  connection = fakeConnection({ peerOrigin: 'https://app.test' })
  ui = fakeDocumentUi()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
it('permits OAuth only after authenticated worker dispatch, reporting cache counts [CSP-013] [LIBID-BROWSER-029]', async () => {
  let elapsed = 25
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  let activated!: () => void
  let dispatched!: (counts: { cached: number; fetched: number }) => void
  connection = fakeConnection({ peerOrigin: 'https://app.test', ready: 'pending' })
  registerRootWorker.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      activated = resolve
    }),
  )
  dispatchPrefetch.mockReturnValueOnce(
    new Promise((resolve) => {
      dispatched = resolve
    }),
  )
  const run = startPrefetch(fragment())
  // The registration waits for authenticated readiness, after the connection's lookup.
  await new Promise((resolve) => setTimeout(resolve))
  expect(registerRootWorker).not.toHaveBeenCalled()
  expect(connection.sent).toEqual([])
  elapsed = 2025
  connection.settle()
  await vi.waitFor(() => expect(registerRootWorker).toHaveBeenCalledOnce())
  expect(dispatchPrefetch).not.toHaveBeenCalled()
  elapsed = 2100
  activated()
  await vi.waitFor(() => expect(dispatchPrefetch).toHaveBeenCalledOnce())
  expect(connection.sent).toEqual([])
  elapsed = 2130
  dispatched({ cached: 3, fetched: 1 })
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
          'assets-cached': 3,
          'assets-fetched': 1,
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
it('tells the Application when the Worker serves no requests for the profile', async () => {
  dispatchPrefetch.mockRejectedValue(new Error('Asset profile not served'))
  await startPrefetch(fragment('x'))
  expect(connection.sent).toEqual([
    { type: 'ceremony-failed', event: 'prefetch-dispatch', message: 'Asset profile not served' },
  ])
  expect(ui.failures).toEqual([messages.returnToApplication('Asset profile not served')])
})

it('forwards the Worker journal before readiness and locates the startup wait [LIBID-BROWSER-029]', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(40)
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    {
      workerStart: 5,
      fetchStart: 30,
      responseStart: 35,
      responseEnd: 37,
      domInteractive: 39,
    } as PerformanceNavigationTiming,
  ])
  dispatchPrefetch.mockResolvedValue(undefined)
  drainJournal.mockResolvedValue([
    { event: 'root-worker-activate', phase: 'started', timestamp: 7, operationId: 'a' },
    { event: 'root-worker-start', timestamp: 9, operationId: 'b' },
  ])
  await startPrefetch(fragment())
  const sent = connection.sent
  expect(sent.slice(0, 2)).toEqual([
    {
      type: 'event',
      event: 'root-worker-activate',
      phase: 'started',
      timestamp: 7,
      instrumentation: { operationId: 'a' },
    },
    {
      type: 'event',
      event: 'root-worker-start',
      timestamp: 9,
      instrumentation: { operationId: 'b' },
    },
  ])
  expect(sent[2]).toMatchObject({
    event: 'prefetch-dispatch',
    phase: 'finished',
    instrumentation: {
      attributes: {
        'document-startup-ms': 40,
        'navigation-worker-ms': 5,
        'navigation-fetch-ms': 30,
        'navigation-response-ms': 35,
        'navigation-response-end-ms': 37,
        'navigation-dom-interactive-ms': 39,
      },
    },
  })
})

it('aborts worker registration, prefetch dispatch and journal drain when the connection ends', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  let regSignal!: AbortSignal
  registerRootWorker.mockImplementationOnce(
    (_url: string, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        regSignal = signal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const run = startPrefetch(fragment())
  await vi.waitFor(() => expect(registerRootWorker).toHaveBeenCalledOnce())
  expect(regSignal.aborted).toBe(false)
  connection.end()
  await run
  expect(regSignal.aborted).toBe(true)
  expect(dispatchPrefetch).not.toHaveBeenCalled()
  expect(connection.sent).toEqual([])
  expect(ui.failures).toEqual([messages.returnToApplication(messages.connectionEnded)])
  expect(log).toHaveBeenCalledOnce()

  // Failing dispatchPrefetch also aborts the sibling drainJournal wait immediately.
  vi.clearAllMocks()
  connection = fakeConnection({ peerOrigin: 'https://app.test' })
  ui = fakeDocumentUi()
  let journalSignal!: AbortSignal
  dispatchPrefetch.mockRejectedValueOnce(new Error('Asset profile not served'))
  drainJournal.mockImplementationOnce(
    (_worker: unknown, signal: AbortSignal) =>
      new Promise<never[]>((resolve) => {
        journalSignal = signal
        signal.addEventListener('abort', () => resolve([]), { once: true })
      }),
  )
  await startPrefetch(fragment('x'))
  expect(journalSignal.aborted).toBe(true)
})
