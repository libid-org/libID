import { PopupError } from '@libid/popup'
import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CEREMONY_ID, type FakeDocumentUi, fakeDocumentUi } from '../../testing/index.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { startCallback } from './callback.js'

const { accept, current } = vi.hoisted(() => ({ accept: vi.fn(), current: vi.fn() }))

vi.mock('@libid/popup', async (original) => ({
  ...(await original<typeof import('@libid/popup')>()),
  PopupConnection: { accept },
  PopupWindow: { current },
}))

vi.mock('./ui.js', async () => (await import('../../testing/index.js')).documentUi(() => ui))

const id = CEREMONY_ID

const v1Inputs = [['https://app.test', 'https://ccdp.test'], 'https://ccdp.test']

let connection: FakeConnection,
  ui: FakeDocumentUi,
  config: unknown,
  locationInput: { search: string; hash: string; pathname: string; origin: string }

const cleared = () => expect(locationInput.search + locationInput.hash).toBe('')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  connection = fakeConnection({ peerOrigin: 'https://app.test' })
  ui = fakeDocumentUi()
  config = v1Inputs
  locationInput = {
    search: '',
    hash: `#state=v1.${id}&error=access_denied`,
    pathname: '/callback',
    origin: 'https://bridge.test',
  }
  vi.stubGlobal('location', locationInput)
  vi.stubGlobal('history', {
    replaceState: vi.fn(() => {
      locationInput.search = ''
      locationInput.hash = ''
    }),
  })
  vi.stubGlobal('document', { getElementById: () => ({ textContent: JSON.stringify(config) }) })
  vi.spyOn(ui, 'view').mockImplementation(cleared)
  accept.mockImplementation(() => {
    cleared()
    return connection
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The Prover fragment of the one navigation Callback made. */
const proverFragment = () => new URLSearchParams(connection.navigations[0].fragment)

it('clears before acceptance and preserves exact private return with shared deployment inputs, exchanging nothing [KIT-006] [KIT-010] [KIT-012] [TEST-CCDP-03] [LIBID-ASSET-006] [LIBID-OAUTH-005] [LIBID-OAUTH-011] [LIBID-OAUTH-028] [LIBID-BROWSER-004]', async () => {
  const original = locationInput.hash
  connection.peerOrigin = 'https://other-app.test'
  config = [['https://other-app.test', 'https://other-ccdp.test'], 'https://other-ccdp.test']
  const send = vi.spyOn(connection, 'send')
  const navigate = vi.spyOn(connection, 'navigate')
  // Only the isolated Prover exchanges the return; Callback fetches nothing.
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  startCallback()
  await Promise.resolve()
  expect(fetch).not.toHaveBeenCalled()
  expect(accept).toHaveBeenCalledWith(undefined, {
    connectionId: id,
    allowedApplicationOrigins: ['https://other-app.test', 'https://other-ccdp.test'],
  })
  expect(connection.navigations).toEqual([
    {
      url: 'https://other-ccdp.test/ccdp/v1/prover',
      fragment: new URLSearchParams({
        ceremonyId: id,
        applicationOrigin: 'https://other-app.test',
        oauthQuery: '',
        oauthFragment: original,
      }).toString(),
      away: false,
    },
  ])
  expect(connection.sent).toEqual([
    { type: 'event', event: 'authorization', phase: 'finished', timestamp: expect.any(Number) },
  ])
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0])
})

it.each(['2', '99', '99999999999999999999'])(
  'rejects unbundled/retired version %s locally [LIBID-ASSET-015] [LIBID-ASSET-007]',
  (version) => {
    locationInput.hash = `#state=v${version}.${id}`
    startCallback()
    expect(ui.view).toHaveBeenCalledWith(expect.stringContaining('no longer supported'))
    expect(accept).not.toHaveBeenCalled()
    expect(current).not.toHaveBeenCalled()
    expect(connection.sent).toEqual([])
  },
)

it.each([
  { search: `?state=v1.${id}`, hash: `#state=v1.${id}` },
  { hash: `#state=v01.${id}` },
  { hash: `#state=v0.${id}` },
  { hash: `#state=v1.${id.toUpperCase()}` },
  { hash: '#state=v1.invalid' },
  { hash: `#state=v1.${id}%FF` },
  { hash: '#code=x' },
  { hash: `#${'x'.repeat(32768)}` },
])(
  'clears malformed or oversized return before fixed local failure [KIT-010] [LIBID-OAUTH-005] [LIBID-OAUTH-023]',
  (input) => {
    Object.assign(locationInput, input)
    startCallback()
    expect(ui.view).toHaveBeenCalledWith(expect.stringMatching(/Return to your application/))
    expect(accept).not.toHaveBeenCalled()
  },
)

it.each(
  [
    null,
    {},
    { versionedInputs: { 1: v1Inputs } },
    [],
    [['https://app.test']],
    [[], 'https://ccdp.test'],
    [['https://app.test'], 'https://ccdp.test'], // Missing effective CCDP admission.
    [['https://app.test', 'https://app.test'], 'https://ccdp.test'],
    [['https://app.test/path'], 'https://ccdp.test'],
    [['https://app.test'], 'https://ccdp.test/path'],
    ['https://app.test', 'https://ccdp.test'],
    [[null], 'https://ccdp.test'],
    [['https://app.test'], null],
  ].map((input) => ({ input })),
)('rejects malformed deployment data before connection setup [KIT-010]', ({ input }) => {
  config = input
  startCallback()
  expect(ui.view).toHaveBeenCalledWith(expect.stringMatching(/Return to your application/))
  expect(accept).not.toHaveBeenCalled()
})

it.each([null, { textContent: '' }, { textContent: '[' }])(
  'reports a missing or unparsable deployment slot as invalid inputs: %o [KIT-010]',
  (slot) => {
    vi.stubGlobal('document', { getElementById: () => slot })
    startCallback()
    expect(ui.view).toHaveBeenCalledExactlyOnceWith(
      messages.returnToApplication(messages.invalidCallbackInputs),
    )
    expect(accept).not.toHaveBeenCalled()
  },
)

it('clears a double-slash callback path without treating it as another host [CSP-005]', () => {
  locationInput.pathname = '//auth/callback'
  startCallback()
  expect(history.replaceState).toHaveBeenCalledWith(null, '', 'https://bridge.test//auth/callback')
  expect(accept).toHaveBeenCalledOnce()
})

it.each([[], [null], [{ optional: { nested: [1, 2] } }]].map((trailing) => ({ trailing })))(
  'ignores optional trailing inputs and deeply freezes the parsed list [LIBID-ASSET-015] [KIT-010] [LIBID-ASSET-006]',
  async ({ trailing }) => {
    config = [...v1Inputs, ...trailing]
    const parse = vi.spyOn(JSON, 'parse')
    try {
      startCallback()
      await Promise.resolve()
      const inputs = parse.mock.results[0].value
      expect(Object.isFrozen(inputs)).toBe(true)
      expect(Object.isFrozen(inputs[0])).toBe(true)
      if (inputs[2]?.optional) {
        expect(Object.isFrozen(inputs[2].optional.nested)).toBe(true)
        expect(() => inputs[2].optional.nested.push(3)).toThrow()
      }
      expect(accept).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          allowedApplicationOrigins: ['https://app.test', 'https://ccdp.test'],
        }),
      )
      expect(connection.navigations).toEqual([
        { url: 'https://ccdp.test/ccdp/v1/prover', fragment: expect.any(String), away: false },
      ])
    } finally {
      parse.mockRestore()
    }
  },
)

it('does not prevent private navigation when the advisory readiness send fails [LIBID-OAUTH-028]', async () => {
  vi.spyOn(connection, 'send').mockImplementationOnce(() => {
    throw new Error('transport send failure')
  })
  startCallback()
  await Promise.resolve()
  expect(connection.navigations).toHaveLength(1)
})

it('takes the selected peer from authentication, never from OAuth fields or allowlist order [TEST-CCDP-04] [LIBID-OAUTH-017]', async () => {
  config = [
    ['https://other-app.test', 'https://app.test', 'https://ccdp.test'],
    'https://ccdp.test',
  ]
  locationInput.hash += '&applicationOrigin=https%3A%2F%2Fother-app.test'
  startCallback()
  await Promise.resolve()
  expect(proverFragment().get('applicationOrigin')).toBe('https://app.test')
  expect(proverFragment().get('oauthFragment')).toContain('applicationOrigin=')
})

it('reports a return whose Prover fragment would exceed its bound instead of navigating [LIBID-OAUTH-005]', async () => {
  // Within Callback's own bound, but every `/` re-encodes to three characters.
  locationInput.hash = `#state=v1.${id}&code=${'/'.repeat(22000)}`
  startCallback()
  await vi.waitFor(() =>
    expect(connection.sent).toContainEqual({
      type: 'ceremony-failed',
      event: 'authorization',
      message: messages.oauthReturnTooLarge,
    }),
  )
  expect(connection.navigations).toEqual([])
})

it.each([null, 'null', 'https://app.test/'])(
  'fails locally when the authenticated peer origin is unavailable or invalid: %s [TEST-CCDP-04]',
  async (value) => {
    connection.peerOrigin = value
    startCallback()
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(connection.navigations).toEqual([])
    expect(connection.sent).toEqual([])
  },
)

it.each(['ready-first', 'closed-first'])(
  'keeps the connection failure visible locally when Application is unreachable: %s [TEST-CCDP-08] [LIBID-OAUTH-030]',
  async (order) => {
    const error = new PopupError('fallback-unavailable')
    connection = fakeConnection({ ready: 'pending', peerOrigin: null })
    startCallback()
    if (order === 'ready-first') connection.settle(error)
    connection.end({ outcome: 'failed', code: error.code })
    if (order === 'closed-first') connection.settle(error)
    await vi.waitFor(() =>
      expect(ui.events).toContainEqual({
        status: 'failed',
        event: 'authorization',
        message: popupErrorMessages[error.code],
        timestamp: expect.any(Number),
      }),
    )
    expect(connection.navigations).toEqual([])
    expect(connection.sent).toEqual([])
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
  },
)

it('ignores readiness that arrives after the connection closed [LIBID-BROWSER-022]', async () => {
  connection = fakeConnection({ ready: 'pending', peerOrigin: 'https://app.test' })
  startCallback()
  connection.end()
  connection.settle()
  await connection.ready
  expect(ui.events).toEqual([
    expect.objectContaining({ status: 'failed', message: messages.callbackClosed }),
  ])
  // The ended connection cannot carry the report; its loss is logged locally.
  expect(connection.sent).toEqual([])
  expect(console.error).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
  expect(connection.navigations).toEqual([])
})

it.each(['*', '*.lib.id'])(
  'passes Bridge admission pattern %s to Popup and retains only the exact authenticated origin',
  async (pattern) => {
    config = [[pattern, 'https://ccdp.test'], 'https://ccdp.test']
    connection.peerOrigin = 'https://wallet.preview.lib.id'
    startCallback()
    await Promise.resolve()
    expect(accept).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        allowedApplicationOrigins: [pattern, 'https://ccdp.test'],
      }),
    )
    expect(proverFragment().get('applicationOrigin')).toBe(connection.peerOrigin)
  },
)

it.each(['success', 'rejected', 'failed'] as const)(
  'distinguishes expected connection retirement from a failed handoff: %s [TEST-CCDP-08]',
  async (outcome) => {
    const navigate = vi.spyOn(connection, 'navigate').mockImplementationOnce(async () => {
      connection.end(
        outcome === 'failed'
          ? { outcome: 'failed', code: 'fallback-unavailable' }
          : { outcome: 'closed' },
      )
      await Promise.resolve()
      if (outcome === 'rejected') throw new Error('Navigation failed')
    })
    startCallback()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    const failures = ui.events.filter((event) => event.status === 'failed')
    expect(failures).toHaveLength(outcome === 'success' ? 0 : 1)
    if (outcome === 'success') expect(console.error).not.toHaveBeenCalled()
  },
)
