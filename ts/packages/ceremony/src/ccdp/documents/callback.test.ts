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
const defaults = [['https://app.test'], 'https://ccdp.test']
let config: unknown,
  locationInput: { search: string; hash: string; pathname: string; origin: string }
beforeEach(() => {
  vi.clearAllMocks()
  config = { defaultInputs: defaults, inputOverrides: {} }
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
afterEach(() => vi.unstubAllGlobals())
it('clears before acceptance and preserves exact private return with selected deployment inputs [KIT-006] [KIT-010]', async () => {
  const original = locationInput.hash
  config = {
    defaultInputs: [],
    inputOverrides: { 1: [['https://other-app.test'], 'https://other-ccdp.test'] },
  }
  startCallback()
  await Promise.resolve()
  expect(accept).toHaveBeenCalledWith(undefined, {
    fallback: undefined,
    connectionId: id,
    allowedApplicationOrigins: ['https://other-app.test'],
  })
  expect(navigate).toHaveBeenCalledWith(
    'https://other-ccdp.test/ccdp/v1/prover',
    new URLSearchParams({ ceremonyId: id, oauthQuery: '', oauthFragment: original }),
  )
  expect(send).not.toHaveBeenCalled()
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
  expect(view).toHaveBeenCalledWith('Unable to continue. Return to your application.')
  expect(accept).not.toHaveBeenCalled()
})
it.each([
  null,
  {},
  { defaultInputs: defaults },
  { defaultInputs: defaults, inputOverrides: {}, extra: 1 },
  { defaultInputs: defaults, inputOverrides: { '01': defaults } },
  { defaultInputs: [[], 'https://ccdp.test'], inputOverrides: {} },
  {
    defaultInputs: [['https://app.test', 'https://app.test'], 'https://ccdp.test'],
    inputOverrides: {},
  },
  { defaultInputs: [['https://app.test'], 'https://ccdp.test/path'], inputOverrides: {} },
  { defaultInputs: defaults, inputOverrides: { 1: ['wrong'] } },
])('rejects malformed deployment data before connection setup [KIT-010]', (input) => {
  config = input
  startCallback()
  expect(view).toHaveBeenCalledWith('Unable to continue. Return to your application.')
  expect(accept).not.toHaveBeenCalled()
})

it('clears a double-slash callback path without treating it as another host [CSP-005]', () => {
  locationInput.pathname = '//auth/callback'
  startCallback()
  expect(history.replaceState).toHaveBeenCalledWith(null, '', 'https://bridge.test//auth/callback')
  expect(accept).toHaveBeenCalledOnce()
})
