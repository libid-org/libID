import { afterEach, expect, it, vi } from 'vitest'
import type { OperationEvent } from '../../../events.js'
import type { ProverContext } from '../../context.js'
import { prove as proveX } from './prover.js'

const { prepare, generate, destroy } = vi.hoisted(() => ({
  prepare: vi.fn(),
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
    prepare = prepare
  },
}))
vi.mock('./transcript.js', async (original) => ({
  ...(await original<typeof import('./transcript.js')>()),
  selectTokenReveals: () => ({ accessToken: 'fixture', ranges: { sent: [], recv: [] } }),
  selectIdentityReveals: () => ({ sent: [{ end: 0 }, { start: 1 }], recv: [] }),
  identityFromReveals: () => ({ userId: '1', handle: 'fixture' }),
}))

afterEach(() => vi.resetAllMocks())

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
  'records independent attestation completion and waits for every output: %s [LIBID-PROVER-007] [LIBID-PROVER-013] [LIBID-PROVER-014]',
  async (outcome) => {
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
      send: vi.fn(async () => transcript({ data: { id: '1', username: 'fixture' } })),
      reveal: vi.fn(async () => ({ openings: [], attestation: identityAttestation.promise })),
    }
    prepare.mockResolvedValueOnce(token).mockResolvedValueOnce(identity)
    generate.mockResolvedValue({ proof: new Uint8Array([1]), publicInputs: [] })
    const events: OperationEvent[] = []
    const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'
    const context: ProverContext = {
      ceremonyId,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      request: {
        type: 'prove-identity',
        platformId: 'x',
        platformCeremonyVersion: 1,
        clientId: 'client',
        codeVerifier: 'a'.repeat(43),
        redirectUri: 'https://bridge.test/callback',
        notaryAddress: 'https://notary.test',
      },
      oauthReturn: { query: `?code=fixture&state=v1.${ceremonyId}`, fragment: '' },
    }
    let settled = false
    const result = proveX(context).finally(() => {
      settled = true
    })
    const checked =
      outcome === 'accepted'
        ? expect(result).resolves.toMatchObject({ identity: { userId: '1' } })
        : expect(result).rejects.toMatchObject({
            event: 'token-attestation',
            message: 'Final attestation failed',
          })
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(identity.send).not.toHaveBeenCalled()
    tokenResponse.resolve(transcript({ access_token: 'fixture' }))
    await vi.waitFor(() => expect(identity.reveal).toHaveBeenCalledOnce())
    // Identity can finish while token openings are still pending; its timestamp must not wait for that join.
    identityAttestation.resolve(new Uint8Array([2]))
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ event: 'identity-attestation', phase: 'finished' }),
      ),
    )
    expect(generate).not.toHaveBeenCalled()
    tokenOpenings.resolve({ openings: [], attestation: tokenAttestation.promise })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    if (outcome === 'accepted') tokenAttestation.resolve(new Uint8Array([3]))
    else tokenAttestation.reject(new Error('Final attestation failed'))
    await checked
    for (const name of ['token-fetch', 'identity-fetch', 'identity-attestation'])
      expect(events.filter((event) => event.event === name).map((event) => event.phase)).toEqual([
        'started',
        'finished',
      ])
    expect(
      events.filter((event) => event.event === 'token-attestation').map((event) => event.phase),
    ).toEqual(outcome === 'accepted' ? ['started', 'finished'] : ['started'])
    expect(destroy).toHaveBeenCalledOnce()
  },
)
