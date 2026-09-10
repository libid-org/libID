import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startCallback } from './callback.js'

const { accept, current, view, navigate, send } = vi.hoisted(() => ({
  accept: vi.fn(),
  current: vi.fn(),
  view: vi.fn(),
  navigate: vi.fn(),
  send: vi.fn(),
}))
vi.mock('virtual:ceremony-popup-fallback', () => ({ fallback: undefined }))
vi.mock('@libid/popup', () => ({ PopupConnection: { accept }, PopupWindow: { current } }))
vi.mock('../../ui.js', () => ({ view }))
const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'
const v1Inputs = [['https://app.test', 'https://ccdp.test'], 'https://ccdp.test']
let config: unknown,
  locationInput: { search: string; hash: string; pathname: string; origin: string }
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
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
  view.mockImplementation(() => {
    expect(locationInput.search + locationInput.hash).toBe('')
  })
  accept.mockImplementation(() => {
    expect(locationInput.search + locationInput.hash).toBe('')
    return { ready: Promise.resolve(), closed: new Promise(() => {}), on: vi.fn(), navigate, send }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('clears before acceptance and preserves exact private return with shared deployment inputs [KIT-006] [KIT-010]', async () => {
  const original = locationInput.hash
  config = [['https://other-app.test', 'https://other-ccdp.test'], 'https://other-ccdp.test']
  startCallback()
  await Promise.resolve()
  expect(accept).toHaveBeenCalledWith(undefined, {
    fallback: undefined,
    connectionId: id,
    allowedApplicationOrigins: ['https://other-app.test', 'https://other-ccdp.test'],
  })
  expect(navigate).toHaveBeenCalledWith(
    'https://other-ccdp.test/ccdp/v1/prover',
    new URLSearchParams({ ceremonyId: id, oauthQuery: '', oauthFragment: original }),
  )
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'callback-ready' })
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0])
})
it.each(['2', '99', '99999999999999999999'])(
  'rejects unbundled/retired version %s locally [LIBID-ASSET-015]',
  (version) => {
    locationInput.hash = `#state=v${version}.${id}`
    startCallback()
    expect(view).toHaveBeenCalledWith(expect.stringContaining('no longer supported'))
    expect(accept).not.toHaveBeenCalled()
    expect(current).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
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
])('clears malformed or oversized return before fixed local failure [KIT-010]', (input) => {
  Object.assign(locationInput, input)
  startCallback()
  expect(view).toHaveBeenCalledWith(
    'Invalid OAuth callback or deployment configuration. (callback-input) Return to your application.',
  )
  expect(accept).not.toHaveBeenCalled()
})
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
  expect(view).toHaveBeenCalledWith(
    'Invalid OAuth callback or deployment configuration. (callback-input) Return to your application.',
  )
  expect(accept).not.toHaveBeenCalled()
})

it('clears a double-slash callback path without treating it as another host [CSP-005]', () => {
  locationInput.pathname = '//auth/callback'
  startCallback()
  expect(history.replaceState).toHaveBeenCalledWith(null, '', 'https://bridge.test//auth/callback')
  expect(accept).toHaveBeenCalledOnce()
})

it.each([[], [null], [{ optional: { nested: [1, 2] } }]].map((trailing) => ({ trailing })))(
  'ignores optional trailing inputs and deeply freezes the parsed list [LIBID-ASSET-015] [KIT-010]',
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
      expect(navigate).toHaveBeenCalledWith(
        'https://ccdp.test/ccdp/v1/prover',
        expect.any(URLSearchParams),
      )
    } finally {
      parse.mockRestore()
    }
  },
)

it('does not prevent private navigation when the advisory readiness send fails', async () => {
  send.mockImplementationOnce(() => {
    throw new Error('transport send failure')
  })
  startCallback()
  await Promise.resolve()
  expect(navigate).toHaveBeenCalledOnce()
})
