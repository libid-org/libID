import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CeremonyError } from '../../../errors.js'
import type { NotarizationSession } from '../../../notary/session.js'
import type { ProverContext } from '../../context.js'
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

vi.mock('../../../assets/index.js', async (original) => ({
  ...(await original<typeof import('../../../assets/index.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))

vi.mock('../../../barretenberg/engine.js', () => ({
  ProofEngine: class {
    destroy = destroy
  },
}))

vi.mock('./token.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./token.js')>()),
  decodeTokenResponse: () => ({ accessToken: 'test-bearer' }),
  admitTokenResponse: admit,
}))

vi.mock('../../../notary/session.js', () => ({
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
    emit: vi.fn(),
    request: {
      type: 'prove-identity',
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
  expect(input.emit).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(created).not.toHaveBeenCalled()
})

it('rejects a mismatched issuer before token exchange', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(prove(context({ code: 'test', iss: 'https://other.test' }))).rejects.toMatchObject({
    event: 'authorization',
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
    event: 'token-attestation',
    cause,
  })
  expect(input.emit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ event: 'token-attestation', phase: 'started' }),
  )
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
    const fetch = vi.fn<typeof globalThis.fetch>(() => token.promise)
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { userAgent: 'browser fixture' })
    // Stop at the first authenticated HTTP send; this test does not simulate proofs.
    const sent = new Error('reached identity HTTP request')
    send.mockRejectedValue(sent)
    const input = context({ code: 'test' })
    const result = prove(input).catch((error) => error)
    expect(prepare).toHaveBeenCalledExactlyOnceWith('https://api.github.com/user')
    expect(fetch).toHaveBeenCalledOnce()
    const posted = JSON.parse(new TextDecoder().decode(fetch.mock.calls[0][1]!.body as ArrayBuffer))
    expect(posted.redirectUri).toBe('https://bridge.test/callback')
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
    expect(await result).toMatchObject({ message: sent.message, event: 'identity-fetch' })
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
  const failure = new CeremonyError('identity-fetch', 'Notary failed')
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
  expect(await result).toMatchObject({ message: abort.signal.reason.message })
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
  const failure = new CeremonyError('identity-fetch', 'Notary failed')
  runtimeFailure.current.abort(failure)
  expect(await result).toBe(failure)
  expect(fetchSignal.aborted).toBe(true)
  expect(send).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
})
