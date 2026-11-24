import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, type FakeDocumentUi, fakeDocumentUi } from '../../testing/index.js'
import { messages } from '../uiMessages.js'
import { JOURNAL_GRACE_MS, startPrefetch } from './prefetch.js'

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

it('does not block OAuth readiness past the journal grace window when the journal stalls', async () => {
  vi.useFakeTimers()
  try {
    drainJournal.mockReturnValueOnce(new Promise(() => {}))
    dispatchPrefetch.mockResolvedValueOnce({ cached: 2, fetched: 0 })
    const run = startPrefetch(fragment())
    await vi.advanceTimersByTimeAsync(JOURNAL_GRACE_MS)
    await run
    expect(connection.sent).toEqual([
      expect.objectContaining({
        type: 'event',
        event: 'prefetch-dispatch',
        phase: 'finished',
      }),
    ])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('forwards the Worker journal before readiness and locates the startup wait [LIBID-BROWSER-029]', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(40)
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { workerStart: 5, fetchStart: 30, responseStart: 35 } as PerformanceNavigationTiming,
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
      },
    },
  })
})
