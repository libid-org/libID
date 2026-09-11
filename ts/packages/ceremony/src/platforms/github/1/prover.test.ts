import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CeremonyError } from '../../../errors.js'
import type { ProverContext } from '../../../prover/context.js'
import type { NotarizationSession } from '../../../prover/notarization/session.js'
import { prove } from './prover.js'

const { admit, prepare, send, created, destroy, runtimeFailure } = vi.hoisted(() => ({
  admit: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  created: vi.fn(),
  destroy: vi.fn(),
  runtimeFailure: { current: new AbortController() },
}))
vi.mock('virtual:ceremony-assets', () => ({ urls: {} }))
vi.mock('../../../assets.js', async (original) => ({
  ...(await original<typeof import('../../../assets.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))
vi.mock('../../../prover/engine.js', () => ({
  PROOF_ENGINE_SPANS: [],
  ProofEngine: class {
    destroy = destroy
  },
}))
vi.mock('./token.js', () => ({
  encodeTokenRequest: () => new Uint8Array(),
  decodeTokenResponse: () => ({ accessToken: 'test-bearer' }),
  admitTokenResponse: admit,
}))
vi.mock('../../../prover/notarization/session.js', () => ({
  Notarization: class {
    readonly signal: AbortSignal
    constructor(address: string, signal: AbortSignal) {
      this.signal = AbortSignal.any([signal, runtimeFailure.current.signal])
      created(address, signal)
    }
    prepare = prepare
  },
}))
beforeEach(() => {
  runtimeFailure.current = new AbortController()
  admit.mockReset().mockReturnValue({})
  send.mockReset()
  prepare.mockReset().mockResolvedValue({ send })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
function context(outcome: Record<string, string>): ProverContext {
  const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  return {
    ceremonyId,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    onStage: vi.fn(),
    request: {
      type: 'app-start-prover',
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      codeVerifier: 'a'.repeat(43),
      redirectUri: 'https://bridge.test/callback',
      notaryAddress: 'https://notary.test',
    },
    oauthReturn: {
      fragment: '',
      query:
        '?' +
        new URLSearchParams({
          state: `v1.${ceremonyId}`,
          iss: 'https://github.com/login/oauth',
          ...outcome,
        }),
    },
  }
}
it('returns detailed GitHub denial before any token exchange', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const input = context({ error: 'access_denied', error_description: 'Denied', error_uri: '/help' })
  await expect(prove(input)).resolves.toBeNull()
  expect(input.onStage).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(created).not.toHaveBeenCalled()
})
it('rejects a mismatched issuer before token exchange', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(prove(context({ code: 'test', iss: 'https://other.test' }))).rejects.toMatchObject({
    code: 'oauth-return',
  })
  expect(fetch).not.toHaveBeenCalled()
  expect(created).not.toHaveBeenCalled()
})
it('classifies token admission failure and retains its local cause', async () => {
  const cause = new Error('synthetic private admission detail')
  admit.mockImplementation(() => {
    throw cause
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })),
  )
  const input = context({ code: 'test' })
  await expect(prove(input)).rejects.toMatchObject({
    code: 'token-exchange',
    cause,
  })
  expect(input.onStage).toHaveBeenCalledExactlyOnceWith('code-exchange')
  expect(created.mock.calls[0][1].aborted).toBe(true)
  expect(send).not.toHaveBeenCalled()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
it.each(['setup', 'token'])(
  'overlaps GitHub setup and token exchange when %s finishes first [LIBID-PROVER-004]',
  async (first) => {
    const setup = deferred<NotarizationSession>(),
      token = deferred<Response>()
    prepare.mockReturnValue(setup.promise)
    const fetch = vi.fn(() => token.promise)
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { userAgent: 'browser fixture' })
    // Stop at the first authenticated HTTP send; this test does not simulate proofs.
    const sent = new Error('reached identity HTTP request')
    send.mockRejectedValue(sent)
    const input = context({ code: 'test' })
    const result = prove(input).catch((error) => error)
    expect(prepare).toHaveBeenCalledExactlyOnceWith('https://api.github.com/user')
    expect(fetch).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    const ready = () => setup.resolve({ send, reveal: vi.fn() })
    const returned = () =>
      token.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    if (first === 'setup') {
      ready()
      await setup.promise
      expect(admit).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      returned()
    } else {
      returned()
      await vi.waitFor(() => expect(admit).toHaveBeenCalledOnce())
      expect(send).not.toHaveBeenCalled()
      ready()
    }
    expect(await result).toBe(sent)
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: 'https://api.github.com/user',
        headers: expect.objectContaining({
          Authorization: new TextEncoder().encode('Bearer test-bearer'),
        }),
      }),
    )
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
    expect(created.mock.calls[0][1].aborted).toBe(true)
    expect(destroy).toHaveBeenCalledOnce()
  },
)
it('setup failure cancels the Bridge fetch without masking its notary error [LIBID-PROVER-004]', async () => {
  const setup = deferred<NotarizationSession>()
  prepare.mockReturnValue(setup.promise)
  let fetchSignal!: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          fetchSignal = options.signal
          fetchSignal.addEventListener(
            'abort',
            () => reject(new DOMException('fetch aborted', 'AbortError')),
            { once: true },
          )
        }),
    ),
  )
  const result = prove(context({ code: 'test' })).catch((error) => error)
  const failure = new CeremonyError('notarization')
  setup.reject(failure)
  expect(await result).toBe(failure)
  expect(fetchSignal.aborted).toBe(true)
  expect(admit).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
})
it('cancellation stops both pending GitHub branches [LIBID-PROVER-018]', async () => {
  let setupSignal!: AbortSignal, fetchSignal!: AbortSignal
  prepare.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        setupSignal = created.mock.calls[0][1]
        setupSignal.addEventListener('abort', () => reject(setupSignal.reason), { once: true })
      }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          fetchSignal = options.signal
          fetchSignal.addEventListener('abort', () => reject(fetchSignal.reason), { once: true })
        }),
    ),
  )
  const input = context({ code: 'test' }),
    abort = new AbortController()
  input.signal = abort.signal
  const result = prove(input).catch((error) => error)
  abort.abort()
  expect(await result).toBe(abort.signal.reason)
  expect(setupSignal.aborted).toBe(true)
  expect(fetchSignal.aborted).toBe(true)
  expect(send).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
})

it('prepared-runtime failure aborts the pending Bridge request [LIBID-PROVER-018]', async () => {
  let fetchSignal!: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          fetchSignal = options.signal
          fetchSignal.addEventListener(
            'abort',
            () => reject(new DOMException('fetch aborted', 'AbortError')),
            { once: true },
          )
        }),
    ),
  )
  const result = prove(context({ code: 'test' })).catch((error) => error)
  await prepare.mock.results[0].value
  // Unlike setup rejection, this failure happens after preparation has resolved.
  const failure = new CeremonyError('notarization')
  runtimeFailure.current.abort(failure)
  expect(await result).toBe(failure)
  expect(fetchSignal.aborted).toBe(true)
  expect(send).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
})
