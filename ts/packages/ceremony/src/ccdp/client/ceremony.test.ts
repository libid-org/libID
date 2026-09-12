import type { LedgerId } from '@libid/ledger'
import { mainnet, testnet } from '@libid/ledger/testing'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import { describe, expect, it, vi } from 'vitest'
import { deriveAuthorizationDigest } from '../../platforms/authorization.js'
import { platforms } from '../../platforms/index.js'
import { b64urlEncode } from '../../primitives.js'
import { type CeremonyEvent, ccdpClientFromConfig } from './ceremony.js'
import { validateCeremonyConfig } from './config.js'

class Connection implements PopupConnection<Message> {
  ready = Promise.resolve()
  closed = new Promise<never>(() => {})
  send = vi.fn()
  navigate = vi.fn(async (_url: string, _fragment?: URLSearchParams) => {})
  navigateAway = vi.fn(async (_url: string) => {})
  close = vi.fn(async () => {})
  handlers = new Map<string, (v: unknown) => void>()

  on<M extends Message>(type: MessageType<M>, handler: (m: M) => void) {
    if (this.handlers.has(type.type)) throw new Error('Duplicate message handler')
    this.handlers.set(type.type, (v) => handler(type.decode(v)))
    return () => {
      this.handlers.delete(type.type)
    }
  }

  receive(value: Message & Record<string, unknown>) {
    this.handlers.get(value.type)?.(value)
  }
}

const id = '6e171568-54e1-4f0d-aeb5-e8859826476a'

const wireConfig = {
  callbackPath: '/auth/callback',
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client', ceremonyVersions: [1] } },
}

const config = validateCeremonyConfig(wireConfig, 'https://bridge.test')

function setup() {
  const connection = new Connection()
  const data = new Uint8Array([1, 2])
  const ceremony = ccdpClientFromConfig(config).new(
    connection,
    id,
    'google',
    testnet,
    new Uint8Array(32),
    data,
  )
  return { connection, ceremony, data }
}

const identity = {
  platformId: 'google' as const,
  oauthClientId: 'client',
  userId: '1',
  userName: 'a@b.c',
}

const proof = {
  identityProof: new Uint8Array([1]),
  tokenExpiresAt: 42,
  signingKeyModulus: new Uint8Array(256),
}

describe('Client [LIBID-MOD-014] [LIBID-OAUTH-021] [LIBID-PROVER-021]', () => {
  it('uses distinct origins and frozen input; never receives raw OAuth return', async () => {
    const { connection: c, ceremony, data } = setup()
    const events: string[] = []
    ceremony.onEvent((e) => events.push(e.status === 'active' ? `${e.event}.${e.phase}` : e.status))
    data[0] = 9
    const pending = ceremony.proveUserIdentity()
    expect(c.navigate.mock.calls[0][0]).toBe('https://ccdp.test/ccdp/v1/prefetch')
    c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
    expect(c.navigateAway).toHaveBeenCalledOnce()
    c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
    expect(c.send.mock.calls[0][0]).toEqual({
      type: 'prove-identity',
      platformId: 'google',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: config.redirectUri,
      codeVerifier: null,
      notaryAddress: null,
    })
    c.receive({ type: 'identity-proof', identity, proof })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected accepted')
    expect(result.identity).toBe(identity)
    expect(Object.keys(result.oauthProof)).toEqual([
      'platformCeremonyVersion',
      'authorizationNonce',
      'proof',
    ])
    expect(new URL(c.navigateAway.mock.calls[0][0]).searchParams.get('redirect_uri')).toBe(
      config.redirectUri,
    )
    expect(new URL(c.navigateAway.mock.calls[0][0]).searchParams.get('nonce')).toBe(
      b64urlEncode(
        deriveAuthorizationDigest({
          chainId: testnet.hash(),
          operationDomain: new Uint8Array(32),
          transactionData: new Uint8Array([1, 2]),
          platformCeremonyVersion: 1,
          authorizationNonce: result.oauthProof.authorizationNonce,
        }),
      ),
    )
    expect(result.oauthProof.proof.identityProof).toEqual(new Uint8Array([1]))
    expect(events).toEqual([
      'prefetch-dispatch.started',
      'prefetch-dispatch.finished',
      'authorization.started',
      'prover.started',
      'completed',
    ])
    expect(c.close).not.toHaveBeenCalled()
    c.receive({ type: 'identity-proof', identity, proof })
    expect(events).toEqual([
      'prefetch-dispatch.started',
      'prefetch-dispatch.finished',
      'authorization.started',
      'prover.started',
      'completed',
    ])
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('one-shot')
  })
  it('cancellation wins over late delivery and preserves the popup [LIBID-BROWSER-005]', async () => {
    const { connection: c, ceremony } = setup()
    const result = ceremony.proveUserIdentity()
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await ceremony.cancel()
    c.receive({ type: 'identity-proof', identity, proof })
    await rejection
    expect(c.close).not.toHaveBeenCalled()
  })
  it('rejects invalid predecessors', async () => {
    const { connection: c, ceremony } = setup()
    const pending = ceremony.proveUserIdentity()
    c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
    await expect(pending).rejects.toMatchObject({
      name: 'CeremonyError',
      event: 'prefetch-dispatch',
      message: expect.stringContaining('sequence'),
    })
  })
  it('denial resolves only after start; observer failure is inert', async () => {
    const { connection: c, ceremony } = setup()
    ceremony.onEvent(() => {
      throw new Error('observer')
    })
    const pending = ceremony.proveUserIdentity()
    c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
    c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
    c.receive({ type: 'cancel' })
    await expect(pending).resolves.toEqual({ status: 'denied' })
  })
  it('rejects setup failures without leaking handlers or connection ownership', async () => {
    const { connection: c, ceremony } = setup()
    c.handlers.set('event', () => {})
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('initialize')
    expect([...c.handlers.keys()]).toEqual(['event'])
    c.handlers.clear()
    const next = ccdpClientFromConfig(config).new(
      c,
      id,
      'google',
      testnet,
      new Uint8Array(32),
      new Uint8Array(),
    )
    const result = next.proveUserIdentity()
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await next.cancel()
    await rejection
  })
  it('ignores unknown platforms and rejects oversized Google audiences', () => {
    expect(
      validateCeremonyConfig(
        { ...wireConfig, platforms: { ...wireConfig.platforms, future: null } },
        'https://bridge.test',
      ).platforms,
    ).toEqual(config.platforms)
    expect(() =>
      validateCeremonyConfig(
        {
          ...wireConfig,
          platforms: { google: { clientId: 'x'.repeat(129), ceremonyVersions: [1] } },
        },
        'https://bridge.test',
      ),
    ).toThrow()
  })
  it('accepts a local HTTP CCDP on a separate origin [LIBID-MOD-011]', () => {
    for (const host of ['localhost', '127.0.0.1']) {
      const bridge = `http://${host}:4682`
      for (const ccdpOrigin of [`http://${host}`, `http://${host}:4683`]) {
        const local = { ...wireConfig, ccdpOrigin, callbackPath: '/auth/callback' }
        expect(validateCeremonyConfig(local, bridge)).toMatchObject({
          ccdpOrigin,
          redirectUri: `${bridge}/auth/callback`,
        })
      }
    }
    expect(() =>
      validateCeremonyConfig(
        { ...wireConfig, ccdpOrigin: 'http://ccdp.test' },
        'https://bridge.test',
      ),
    ).toThrow()
  })
  it('validates configuration without coupling Bridge and CCDP [LIBID-OAUTH-001]', () => {
    expect(validateCeremonyConfig(wireConfig, 'https://bridge.test').ccdpOrigin).toBe(
      'https://ccdp.test',
    )
    for (const patch of [
      { ccdpOrigin: 'https://ccdp.test/' },
      ...[
        undefined,
        null,
        0,
        '',
        'callback',
        '//elsewhere.test/callback',
        'https://elsewhere.test/callback',
        '/a/../callback',
        '/callback?',
        '/callback#',
        '/callback?x=1',
        '/callback#x',
        '/callback\\elsewhere',
        '/ callback',
        `/${'a'.repeat(2048)}`,
      ].map((callbackPath) => ({ callbackPath })),
      { redirectUri: 'https://bridge.test/auth/callback' },
      { allowedAppOrigins: [] },
    ])
      expect(() =>
        validateCeremonyConfig({ ...wireConfig, ...patch }, 'https://bridge.test'),
      ).toThrow()
  })
})

it('rejects a duplicate live ID without coercing boxed strings [KIT-008]', async () => {
  const client = ccdpClientFromConfig(config),
    input = {
      connection: new Connection(),
      ledgerId: testnet,
      platformId: 'google' as const,
      operationDomain: new Uint8Array(32),
      transactionData: new Uint8Array(),
    }
  const first = client.new(
    input.connection,
    id,
    input.platformId,
    input.ledgerId,
    input.operationDomain,
    input.transactionData,
  )
  expect(() =>
    client.new(
      new Connection(),
      id,
      input.platformId,
      input.ledgerId,
      input.operationDomain,
      input.transactionData,
    ),
  ).toThrow('already live')
  expect(() =>
    client.new(
      input.connection,
      Object(id) as string,
      input.platformId,
      input.ledgerId,
      input.operationDomain,
      input.transactionData,
    ),
  ).toThrow()
  await first.cancel()
  expect(() =>
    client.new(
      input.connection,
      id,
      input.platformId,
      input.ledgerId,
      input.operationDomain,
      input.transactionData,
    ),
  ).not.toThrow()
})

it('rejects changed form serialization for X/GitHub client IDs, not signed Google audiences', () => {
  for (const platform of ['x', 'github'])
    for (const clientId of ['a+b', 'a b', 'a%2Fb', 'é'])
      expect(() =>
        validateCeremonyConfig(
          { ...wireConfig, platforms: { [platform]: { clientId, ceremonyVersions: [1] } } },
          'https://bridge.test',
        ),
      ).toThrow()
  expect(() =>
    validateCeremonyConfig(
      { ...wireConfig, platforms: { google: { clientId: 'a+b', ceremonyVersions: [1] } } },
      'https://bridge.test',
    ),
  ).not.toThrow()
})

it.each(['google', 'x', 'github'] as const)(
  'snapshots ledger hash and routing once for %s [LIBID-MOD-014/015]',
  async (platformId) => {
    const hash = testnet.hash(),
      domain = new Uint8Array(32),
      data = new Uint8Array([1, 2])
    const ledger = {
      hash: vi.fn(() => hash),
      notaryAddress: vi.fn(() => 'https://local-notary.test:8443'),
    }
    const connection = new Connection()
    const ceremony = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: { clientId: 'client', ceremonyVersions: [1] } },
    }).new(connection, id, platformId, ledger, domain, data)
    expect(ledger.hash).toHaveBeenCalledOnce()
    expect(ledger.notaryAddress).toHaveBeenCalledTimes(platformId === 'google' ? 0 : 1)
    hash.fill(9)
    domain.fill(9)
    data.fill(9)
    ledger.hash.mockImplementation(() => {
      throw new Error('must not reread')
    })
    ledger.notaryAddress.mockImplementation(() => {
      throw new Error('must not reread')
    })
    const pending = ceremony.proveUserIdentity()
    connection.receive({
      type: 'event',
      event: 'prefetch-dispatch',
      phase: 'finished',
      timestamp: 1,
    })
    const authorization = new URL(connection.navigateAway.mock.calls[0][0])
    connection.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
    const message = connection.send.mock.calls[0][0]
    expect(message.notaryAddress).toBe(
      platformId === 'google' ? null : 'https://local-notary.test:8443',
    )
    for (const key of ['ledgerId', 'chainId', 'isTestnet']) expect(message).not.toHaveProperty(key)
    if (platformId === 'google') {
      connection.receive({ type: 'identity-proof', identity, proof })
      const result = await pending
      if (result.status !== 'accepted') throw new Error('Expected proof')
      expect(authorization.searchParams.get('nonce')).toBe(
        b64urlEncode(
          deriveAuthorizationDigest({
            chainId: testnet.hash(),
            operationDomain: new Uint8Array(32),
            transactionData: new Uint8Array([1, 2]),
            platformCeremonyVersion: 1,
            authorizationNonce: result.oauthProof.authorizationNonce,
          }),
        ),
      )
    } else {
      connection.receive({ type: 'cancel' })
      await expect(pending).resolves.toEqual({ status: 'denied' })
    }
  },
)

it('Google never reads the notary method [LIBID-MOD-014]', async () => {
  const ledger = {
    hash: testnet.hash,
    get notaryAddress(): () => string {
      throw new Error('must not read')
    },
  }
  const ceremony = ccdpClientFromConfig(config).new(
    new Connection(),
    id,
    'google',
    ledger,
    new Uint8Array(32),
    new Uint8Array(),
  )
  await ceremony.cancel()
})

it('rejects missing, throwing or malformed hash methods before OAuth [LIBID-MOD-014]', () => {
  const connection = new Connection()
  for (const ledger of [
    null,
    {},
    { hash: 1 },
    ...[null, [], new Uint8Array(31), new Uint8Array(33)].map((hash) => ({ hash: () => hash })),
    {
      hash: () => {
        throw new Error('hash failure')
      },
    },
  ])
    expect(() =>
      ccdpClientFromConfig(config).new(
        connection,
        id,
        'google',
        ledger as LedgerId,
        new Uint8Array(32),
        new Uint8Array(),
      ),
    ).toThrow()
  expect(connection.navigate).not.toHaveBeenCalled()
})

it.each(['x', 'github'] as const)(
  'rejects invalid notary addresses before OAuth for %s [LIBID-OAUTH-021]',
  (platformId) => {
    const connection = new Connection()
    const client = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: { clientId: 'client', ceremonyVersions: [1] } },
    })
    for (const method of [
      undefined,
      1,
      () => {
        throw new Error('address failure')
      },
      ...[
        null,
        1,
        '',
        'http://notary.test',
        'https://notary.test/',
        'https://notary.test/path',
        'https://user@notary.test',
        'https://notary.test?x=1',
        'https://notary.test#x',
        'https://NOTARY.test',
        'https://notary.test:443',
      ].map((value) => () => value),
    ])
      expect(() =>
        client.new(
          connection,
          id,
          platformId,
          { hash: mainnet.hash, notaryAddress: method } as LedgerId,
          new Uint8Array(32),
          new Uint8Array(),
        ),
      ).toThrow()
    expect(connection.navigate).not.toHaveBeenCalled()
    expect(connection.send).not.toHaveBeenCalled()
  },
)

it.each([
  { ...identity, platformId: 'x' },
  { ...identity, oauthClientId: 'other-client' },
  { ...identity, userId: '1'.repeat(32) },
])('rejects a profile or client identity mismatch [LIBID-OAUTH-022]', async (identity) => {
  const { connection, ceremony } = setup()
  const result = ceremony.proveUserIdentity()
  connection.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
  connection.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
  connection.receive({ type: 'identity-proof', identity, proof })
  await expect(result).rejects.toThrow('sequence')
})

// Compile-only API checks: rejected forms must remain rejected by TypeScript.
function checkCreationTypes() {
  const client = ccdpClientFromConfig(config)
  const conn = new Connection(),
    ledger = testnet,
    bytes = new Uint8Array(32)
  // @ts-expect-error Former object form is not supported.
  client.new(id, {
    connection: conn,
    ledgerId: ledger,
    platformId: 'google',
    operationDomain: bytes,
    transactionData: bytes,
  })
  // @ts-expect-error Missing transaction data.
  client.new(conn, id, 'google', ledger, bytes)
  // @ts-expect-error Connection and ceremony ID have incompatible positions.
  client.new(id, conn, 'google', ledger, bytes, bytes)
  void client
    .new(conn, id, 'google', ledger, bytes, bytes)
    .proveUserIdentity()
    .then((result) => {
      if (result.status !== 'accepted') return
      const platform: 'google' = result.identity.platformId
      const proof: Uint8Array = result.oauthProof.proof.identityProof
      // @ts-expect-error Retained operation inputs are not returned in OAuthProof.
      result.oauthProof.transactionData
      // @ts-expect-error Identity is not embedded in the platform proof.
      result.oauthProof.proof.identity
      return { platform, proof }
    })
}

void checkCreationTypes

it('preserves opaque failure text and operation context for the application', async () => {
  const { connection, ceremony } = setup()
  const result = ceremony.proveUserIdentity()
  connection.receive({
    type: 'abort',
    event: 'authorization',
    message: 'Invalid OAuth return or provider authorization error.',
  })
  await expect(result).rejects.toMatchObject({
    name: 'CeremonyError',
    event: 'authorization',
    message: 'Invalid OAuth return or provider authorization error.',
  })
})

it.each(['google', 'x', 'github'] as const)(
  'projects %s stages without delaying or summing overlapping work [LIBID-BROWSER-007]',
  async (platformId) => {
    const c = new Connection()
    const ceremony = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: { clientId: 'client', ceremonyVersions: [1] } },
    }).new(c, id, platformId, testnet, new Uint8Array(32), new Uint8Array())
    const stages: string[] = []
    const events: CeremonyEvent[] = []
    ceremony.onStage((e) => {
      if (e.status === 'active') stages.push(e.stage)
    })
    ceremony.onEvent((e) => events.push(e))
    const result = ceremony.proveUserIdentity()
    const emit = (event: string, phase: 'started' | 'finished', timestamp = 10) =>
      c.receive({ type: 'event', event, phase, timestamp })
    emit('prefetch-dispatch', 'finished')
    emit('authorization', 'finished', 20)
    emit('prover', 'started', 30)
    emit('zk-proof-preparation', 'started', 40)
    if (platformId !== 'google')
      emit(platformId === 'x' ? 'token-fetch' : 'token-attestation', 'started', 50)
    emit('zk-proof-generation', 'started', 60)
    emit('zk-proof-preparation', 'finished', 70)
    emit('zk-proof-generation', 'finished', 80)
    expect(events.at(-1)).toMatchObject({
      event: 'zk-proof-generation',
      status: 'active',
      timestamp: 80,
    })
    expect(stages).toEqual([
      'preparation',
      'authorization',
      'proof-preparation',
      ...(platformId === 'google' ? [] : ['notarization']),
      'zk-proving',
    ])
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await ceremony.cancel()
    await rejection
    expect(events.at(-1)).toMatchObject({ status: 'cancelled' })
    expect(
      events.some(
        (e) => 'event' in e && e.event === 'prover' && 'phase' in e && e.phase === 'finished',
      ),
    ).toBe(false)
  },
)

it.each(['success', 'denied', 'cancelled', 'failed', 'closed', 'invalid-result', 'setup'] as const)(
  'finishes exactly once for %s, before settling the promise [LIBID-BROWSER-008]',
  async (outcome) => {
    const { ceremony, connection } = setup()
    let close!: () => void
    connection.closed = new Promise<never>((resolve) => {
      close = () => resolve(undefined as never)
    })
    if (outcome === 'setup') connection.handlers.set('event', () => {})
    const events: CeremonyEvent[] = []
    let settled = false
    const settledAtFinish: boolean[] = []
    ceremony.onEvent((event) => {
      events.push(event)
      if (event.status !== 'active') {
        settledAtFinish.push(settled)
        // Observer reentry must not turn a success into cancellation or emit twice.
        void ceremony.cancel()
      }
    })
    const result = ceremony.proveUserIdentity().then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    if (outcome !== 'setup') {
      connection.receive({
        type: 'event',
        event: 'prefetch-dispatch',
        phase: 'finished',
        timestamp: 1,
      })
      connection.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
      if (outcome === 'success' || outcome === 'invalid-result')
        connection.receive({
          type: 'identity-proof',
          identity,
          proof: outcome === 'success' ? proof : {},
        })
      else if (outcome === 'denied') connection.receive({ type: 'cancel' })
      else if (outcome === 'cancelled') await ceremony.cancel()
      else if (outcome === 'closed') close()
      else
        connection.receive({
          type: 'abort',
          event: 'zk-proof-generation',
          message: 'Proof engine failed.',
        })
    }
    await result
    close()
    connection.receive({ type: 'identity-proof', identity, proof })
    await ceremony.cancel()
    expect(events.filter((e) => e.status !== 'active')).toEqual([
      expect.objectContaining({
        status: ['closed', 'invalid-result', 'setup'].includes(outcome)
          ? 'failed'
          : outcome === 'success'
            ? 'completed'
            : outcome,
      }),
    ])
    expect(events.at(-1)?.status).not.toBe('active')
    expect(settledAtFinish).toEqual([false])
    if (outcome === 'failed') expect(events.at(-1)).toMatchObject({ event: 'zk-proof-generation' })
  },
)

it('stops event delivery after an observer cancels synchronously', async () => {
  const { ceremony } = setup()
  const events: CeremonyEvent[] = []
  ceremony.onEvent((event) => {
    if (event.status === 'active') void ceremony.cancel()
  })
  ceremony.onEvent((event) => events.push(event))
  await expect(ceremony.proveUserIdentity()).rejects.toMatchObject({ name: 'AbortError' })
  expect(events).toEqual([expect.objectContaining({ status: 'cancelled' })])
})

it('only core readiness events advance the protocol; preserves occurrence times [LIBID-BROWSER-006]', async () => {
  const { ceremony, connection: c } = setup()
  const events: CeremonyEvent[] = []
  ceremony.onEvent((e) => events.push(e))
  const result = ceremony.proveUserIdentity()
  c.receive({ type: 'event', event: 'extension-ready', timestamp: 1 })
  expect(c.navigateAway).not.toHaveBeenCalled()
  c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 2 })
  c.receive({ type: 'event', event: 'authorization', phase: 'finished', timestamp: 3 })
  c.receive({ type: 'event', event: 'prover-fallback', timestamp: 4 })
  expect(c.send).not.toHaveBeenCalled()
  c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 7 })
  c.receive({ type: 'cancel' })
  await expect(result).resolves.toEqual({ status: 'denied' })
  expect(events).toContainEqual({ event: 'prover-fallback', timestamp: 4, status: 'active' })
  expect(events).toContainEqual({
    event: 'prover',
    phase: 'started',
    timestamp: 7,
    status: 'active',
  })
  const count = events.length
  c.receive({ type: 'event', event: 'late', timestamp: 9 })
  expect(events).toHaveLength(count)
})

it('cancellation at authorization entry prevents provider navigation', async () => {
  const { ceremony, connection } = setup()
  ceremony.onEvent((event) => {
    if (event.status === 'active' && event.event === 'authorization' && event.phase === 'started')
      void ceremony.cancel()
  })
  const result = ceremony.proveUserIdentity()
  connection.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(connection.navigateAway).not.toHaveBeenCalled()
})

it('readiness without the optional authorization observation still permits denial', async () => {
  const { ceremony, connection: c } = setup()
  const stages: string[] = []
  ceremony.onStage((e) => stages.push(e.stage))
  const events: CeremonyEvent[] = []
  ceremony.onEvent((e) => events.push(e))
  const result = ceremony.proveUserIdentity()
  c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
  c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 2 })
  c.receive({ type: 'cancel' })
  await expect(result).resolves.toEqual({ status: 'denied' })
  expect(events.at(-1)).toMatchObject({ status: 'denied' })
  expect(stages).toContain('proof-preparation')
})

it('discovers compatible versions and honors explicit selection [LIBID-MOD-015] [LIBID-MOD-020]', async () => {
  // A second catalog entry tests selection only; it is not a new or qualified Google profile.
  Reflect.set(platforms.google.versions, '2', platforms.google.versions[1])
  try {
    const client = ccdpClientFromConfig(
      validateCeremonyConfig(
        {
          ...wireConfig,
          platforms: {
            google: { clientId: identity.oauthClientId, ceremonyVersions: [2, 99, 1] },
            x: { clientId: 'client', ceremonyVersions: [99] },
          },
        },
        'https://bridge.test',
      ),
    )
    expect(client.enabledPlatforms).toEqual(['google'])
    const versions = client.enabledVersions('google')
    expect(versions).toEqual([1, 2])
    expect(Object.isFrozen(versions)).toBe(true)
    expect(client.enabledVersions('x')).toEqual([])
    expect(client.enabledVersions('github')).toEqual([])
    const onlyNewer = ccdpClientFromConfig({
      ...config,
      platforms: { google: { clientId: identity.oauthClientId, ceremonyVersions: [2] } },
    })
    expect(() =>
      onlyNewer.new(
        new Connection(),
        id,
        'google',
        testnet,
        new Uint8Array(32),
        new Uint8Array(),
        1,
      ),
    ).toThrow('Unsupported ceremony version')
    for (const selected of [1, undefined] as const) {
      const c = new Connection()
      const run = client.new(
        c,
        id,
        'google',
        testnet,
        new Uint8Array(32),
        new Uint8Array(),
        selected,
      )
      const version = selected ?? 2
      expect(new URLSearchParams(new URL(run.launchUrl).hash.slice(1)).get('ceremonyVersion')).toBe(
        String(version),
      )
      const pending = run.proveUserIdentity()
      c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
      c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 3 })
      expect(c.send.mock.calls[0][0].platformCeremonyVersion).toBe(version)
      c.receive({ type: 'identity-proof', identity, proof })
      const result = await pending
      expect(result).toMatchObject({ oauthProof: { platformCeremonyVersion: version } })
      if (result.status !== 'accepted') throw new Error('Expected proof')
      const digest = deriveAuthorizationDigest({
        chainId: testnet.hash(),
        operationDomain: new Uint8Array(32),
        transactionData: new Uint8Array(),
        platformCeremonyVersion: version,
        authorizationNonce: result.oauthProof.authorizationNonce,
      })
      expect(new URL(c.navigateAway.mock.calls[0][0]).searchParams.get('nonce')).toBe(
        b64urlEncode(digest),
      )
    }
  } finally {
    Reflect.deleteProperty(platforms.google.versions, '2')
  }
})

it('rejects unavailable explicit versions before reading ledger or reserving the run [LIBID-MOD-015]', async () => {
  const client = ccdpClientFromConfig(config)
  const ledger = { ...testnet, hash: vi.fn(testnet.hash) }
  const c = new Connection()
  for (const version of [0, 2, 99, -1, 1.5, NaN, null, '1']) {
    expect(() =>
      client.new(
        c,
        id,
        'google',
        ledger,
        new Uint8Array(32),
        new Uint8Array(),
        // @ts-expect-error Reject unsupported versions and malformed runtime input.
        version,
      ),
    ).toThrow('Unsupported ceremony version')
  }
  expect(ledger.hash).not.toHaveBeenCalled()
  expect(c.handlers.size).toBe(0)
  const run = client.new(c, id, 'google', ledger, new Uint8Array(32), new Uint8Array(), 1)
  await run.cancel()
})

it('a lost optional operation start does not prevent accepted proof delivery [LIBID-BROWSER-008]', async () => {
  const { ceremony, connection: c } = setup()
  const result = ceremony.proveUserIdentity()
  c.receive({ type: 'event', event: 'prefetch-dispatch', phase: 'finished', timestamp: 1 })
  c.receive({ type: 'event', event: 'prover', phase: 'started', timestamp: 2 })
  c.receive({ type: 'event', event: 'proof', phase: 'finished', timestamp: 4 })
  c.receive({ type: 'identity-proof', identity, proof })
  await expect(result).resolves.toMatchObject({ status: 'accepted' })
})
