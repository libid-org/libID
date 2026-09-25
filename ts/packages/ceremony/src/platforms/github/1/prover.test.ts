import { afterEach, expect, it, vi } from 'vitest'
import type { OperationEvent } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { prove as proveGitHub } from './prover.js'

const { prepare, initialize, generate, destroy } = vi.hoisted(() => ({
  prepare: vi.fn(),
  initialize: vi.fn(),
  generate: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('virtual:ceremony-assets', () => ({ urls: {} }))
vi.mock('../../../assets/index.js', async (original) => ({
  ...(await original<typeof import('../../../assets/index.js')>()),
  resolve: () => 'https://ccdp.test/asset',
}))
vi.mock('../../../barretenberg/engine.js', () => ({
  ProofEngine: class {
    prove = generate
    destroy = destroy
  },
}))
vi.mock('../../../barretenberg/circuits/bearer_link/inputs.js', () => ({
  buildBearerLinkWitness: () => ({}),
  validateBearerLinkPublicInputs: () => true,
}))
vi.mock('../../../notary/notarize.js', () => ({ bearerOpening: () => ({}) }))
vi.mock('../../../notary/session.js', () => ({
  Notarization: class {
    constructor(address: string, signal: AbortSignal, emit: (event: OperationEvent) => void) {
      initialize(address, signal, emit)
    }
    prepare = prepare
  },
}))
vi.mock('./token.js', async (original) => ({
  ...(await original<typeof import('./token.js')>()),
  selectToken: () => ({
    accessToken: 'fixture',
    ranges: { sent: [], received: [] },
    bearerRange: { start: 0, end: 7 },
  }),
}))
vi.mock('./transcript.js', async (original) => ({
  ...(await original<typeof import('./transcript.js')>()),
  selectIdentity: () => ({
    userId: '1',
    userName: 'fixture',
    ranges: { sent: [], received: [] },
    bearerRange: { start: 0, end: 7 },
  }),
}))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
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

function transcript(body: unknown) {
  const json = JSON.stringify(body)
  return {
    sent: new Uint8Array(),
    received: new TextEncoder().encode(
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${json.length}\r\n\r\n${json}`,
    ),
  }
}

it.each(['accepted', 'failed'])(
  'overlaps identity fetch with token openings and waits for every output: %s [LIBID-PROVER-007] [LIBID-PROVER-013] [LIBID-PROVER-014]',
  async (outcome) => {
    vi.stubGlobal('navigator', { userAgent: 'browser fixture' })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    // Synthetic sessions isolate orchestration; real TLSN concurrency has a separate qualification gate.
    const tokenResponse = deferred<ReturnType<typeof transcript>>()
    const tokenOpenings = deferred<{ openings: []; attestation: Promise<Uint8Array> }>()
    const tokenAttestation = deferred<Uint8Array>()
    const identityAttestation = deferred<Uint8Array>()
    const token = {
      send: vi.fn(() => tokenResponse.promise),
      reveal: vi.fn(() => tokenOpenings.promise),
    }
    const identity = {
      send: vi.fn(async () => transcript({ id: 1, login: 'fixture' })),
      reveal: vi.fn(async () => ({ openings: [], attestation: identityAttestation.promise })),
    }
    prepare.mockResolvedValueOnce(token).mockResolvedValueOnce(identity)
    if (outcome === 'accepted')
      generate.mockResolvedValue({ proof: new Uint8Array([1]), publicInputs: [] })
    else generate.mockReturnValue(new Promise(() => {})) // Failure must not await ZK completion.
    const events: OperationEvent[] = []
    const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
    const context: ProverContext = {
      ceremonyId,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      request: {
        type: 'prove-identity',
        platformId: 'github',
        platformCeremonyVersion: 1,
        clientId: 'client',
        clientCredential: 'public-fixture',
        codeVerifier: 'a'.repeat(43),
        redirectUri: 'https://bridge.test/callback',
        notaryAddress: 'https://notary.test',
      },
      oauthReturn: {
        query: `?code=fixture&state=v1.${ceremonyId}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
        fragment: '',
      },
    }
    let settled = false
    const result = proveGitHub(context).finally(() => {
      settled = true
    })
    const checked =
      outcome === 'accepted'
        ? expect(result).resolves.toMatchObject({ identity: { userId: '1' } })
        : expect(result).rejects.toMatchObject({
            event: 'token-attestation',
            message: 'Final attestation failed',
          })
    expect(prepare.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ])
    expect(fetch).not.toHaveBeenCalled()
    expect(identity.send).not.toHaveBeenCalled()
    tokenResponse.resolve(transcript({ access_token: 'fixture' }))
    await vi.waitFor(() => expect(identity.reveal).toHaveBeenCalledOnce())
    // Event timing lives in the real session tests; this fake isolates the platform joins.
    expect(initialize).toHaveBeenCalledWith(
      'https://notary.test',
      expect.any(AbortSignal),
      context.emit,
    )
    expect(prepare.mock.calls.map(([, event]) => event)).toEqual([
      'token-attestation',
      'identity-attestation',
    ])
    identityAttestation.resolve(new Uint8Array([2]))
    expect(generate).not.toHaveBeenCalled()
    tokenOpenings.resolve({ openings: [], attestation: tokenAttestation.promise })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    if (outcome === 'accepted') tokenAttestation.resolve(new Uint8Array([3]))
    else tokenAttestation.reject(new Error('Final attestation failed'))
    await checked
    for (const name of ['token-fetch', 'identity-fetch'])
      expect(events.filter((event) => event.event === name).map((event) => event.phase)).toEqual([
        'started',
        'finished',
      ])
    expect(fetch).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  },
)

it.each(['notaryAddress', 'codeVerifier'] as const)(
  'requires %s before notarization [LIBID-OAUTH-021]',
  async (field) => {
    const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
    const context: ProverContext = {
      ceremonyId,
      signal: new AbortController().signal,
      emit: vi.fn(),
      request: {
        type: 'prove-identity',
        platformId: 'github',
        platformCeremonyVersion: 1,
        clientId: 'client',
        clientCredential: 'public-fixture',
        redirectUri: 'https://bridge.test/callback',
        codeVerifier: 'A'.repeat(43),
        notaryAddress: 'https://notary.test',
      },
      oauthReturn: {
        query: `?code=fixture&state=v1.${ceremonyId}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
        fragment: '',
      },
    }
    context.request[field] = null
    await expect(proveGitHub(context)).rejects.toBeInstanceOf(Error)
    expect(prepare).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  },
)

it.each([
  ['denial', '?error=access_denied', null],
  ['wrong issuer', '?code=fixture&iss=https://other.test', 'authorization'],
  ['missing credential', '?code=fixture', 'token-fetch'],
] as const)('handles %s before any exchange', async (name, query, event) => {
  const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
  const context: ProverContext = {
    ceremonyId,
    signal: new AbortController().signal,
    emit: vi.fn(),
    request: {
      type: 'prove-identity',
      platformId: 'github',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: 'https://bridge.test/auth/callback',
      codeVerifier: 'a'.repeat(43),
      notaryAddress: 'https://notary.test',
      ...(name === 'missing credential' ? {} : { clientCredential: 'public-fixture' }),
    },
    oauthReturn: {
      fragment: '',
      query: `${query}&state=v1.${ceremonyId}${name === 'wrong issuer' ? '' : '&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth'}`,
    },
  }
  if (event === null) await expect(proveGitHub(context)).resolves.toBeNull()
  else await expect(proveGitHub(context)).rejects.toMatchObject({ event })
  expect(prepare).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
})

it.each(['closed', 'identity setup failed'])(
  'retires both sessions and proving when %s [LIBID-PROVER-004]',
  async (failure) => {
    const abort = new AbortController()
    const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
    const context: ProverContext = {
      ceremonyId,
      signal: abort.signal,
      emit: vi.fn(),
      request: {
        type: 'prove-identity',
        platformId: 'github',
        platformCeremonyVersion: 1,
        clientId: 'client',
        clientCredential: 'public-fixture',
        redirectUri: 'https://bridge.test/auth/callback',
        codeVerifier: 'a'.repeat(43),
        notaryAddress: 'https://notary.test',
      },
      oauthReturn: {
        fragment: '',
        query: `?code=fixture&state=v1.${ceremonyId}&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`,
      },
    }
    prepare.mockImplementation(() => {
      const signal: AbortSignal = initialize.mock.calls[0][1]
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const identitySetup = deferred<never>()
    prepare
      .mockImplementationOnce(prepare.getMockImplementation()!)
      .mockReturnValueOnce(identitySetup.promise)
    const result = proveGitHub(context)
    const checked = expect(result).rejects.toMatchObject({
      event: failure === 'closed' ? 'token-fetch' : 'identity-fetch',
      message: failure,
    })
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(initialize).toHaveBeenCalledOnce()
    expect(initialize.mock.calls[0][0]).toBe(context.request.notaryAddress)
    if (failure === 'closed') {
      abort.abort(new Error(failure))
      identitySetup.reject(new Error(failure))
    } else identitySetup.reject(new Error(failure))
    await checked
    expect(initialize.mock.calls[0][1].aborted).toBe(true)
    expect(generate).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  },
)
