import { LedgerId } from '@libid/ledger'
import { deriveAuthorizationDigest } from '../platforms/authorization.js'
import { b64urlEncode } from '../primitives.js'
import { describe, expect, it, vi } from 'vitest'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import { clientFromConfig } from './ceremony.js'
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
const config = {
  redirectUri: 'https://bridge.test/auth/callback',
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client', ceremonyVersions: [1] } },
}
function setup() {
  const connection = new Connection()
  const data = new Uint8Array([1, 2])
  const ceremony = clientFromConfig(config).new(
    connection,
    id,
    LedgerId.decode('test:testnet'),
    'google',
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
    ceremony.onEvent((e) => events.push(e.stage))
    data[0] = 9
    const pending = ceremony.proveUserIdentity()
    expect(c.navigate.mock.calls[0][0]).toBe('https://ccdp.test/ccdp/v1/prefetch')
    c.receive({ type: 'prefetch-started' })
    expect(c.navigateAway).toHaveBeenCalledOnce()
    c.receive({ type: 'prover-ready' })
    expect(c.send.mock.calls[0][0]).toEqual({
      type: 'app-start-prover',
      platformId: 'google',
      platformCeremonyVersion: 1,
      clientId: 'client',
      redirectUri: config.redirectUri,
      codeVerifier: null,
      ledgerId: 'test:testnet',
    })
    c.receive({ type: 'prover-identity-proof', identity, proof })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected accepted')
    expect(result.identity).toBe(identity)
    expect(Object.keys(result.oauthProof)).toEqual([
      'platformCeremonyVersion',
      'authorizationNonce',
      'proof',
    ])
    expect(new URL(c.navigateAway.mock.calls[0][0]).searchParams.get('nonce')).toBe(
      b64urlEncode(
        deriveAuthorizationDigest({
          chainId: LedgerId.decode('test:testnet').hash(),
          operationDomain: new Uint8Array(32),
          transactionData: new Uint8Array([1, 2]),
          platformCeremonyVersion: 1,
          authorizationNonce: result.oauthProof.authorizationNonce,
        }),
      ),
    )
    expect(result.oauthProof.proof.identityProof).toEqual(new Uint8Array([1]))
    expect(events).toEqual(['authorization', 'proof-generation'])
    expect(c.close).not.toHaveBeenCalled()
    c.receive({ type: 'prover-identity-proof', identity, proof })
    expect(events).toEqual(['authorization', 'proof-generation'])
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('one-shot')
  })
  it('cancellation wins over late delivery and preserves the popup [LIBID-BROWSER-005]', async () => {
    const { connection: c, ceremony } = setup()
    const result = ceremony.proveUserIdentity()
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await ceremony.cancel()
    c.receive({ type: 'prover-identity-proof', identity, proof })
    await rejection
    expect(c.close).not.toHaveBeenCalled()
  })
  it('rejects invalid predecessors', async () => {
    const { connection: c, ceremony } = setup()
    const pending = ceremony.proveUserIdentity()
    c.receive({ type: 'prover-ready' })
    await expect(pending).rejects.toThrow('sequence')
  })
  it('denial resolves only after start; observer failure is inert', async () => {
    const { connection: c, ceremony } = setup()
    ceremony.onEvent(() => {
      throw new Error('observer')
    })
    const pending = ceremony.proveUserIdentity()
    c.receive({ type: 'prefetch-started' })
    c.receive({ type: 'prover-ready' })
    c.receive({ type: 'cancel-ceremony' })
    await expect(pending).resolves.toEqual({ status: 'denied' })
  })
  it('rejects setup failures without leaking handlers or connection ownership', async () => {
    const { connection: c, ceremony } = setup()
    c.handlers.set('prover-ready', () => {})
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('initialize')
    expect([...c.handlers.keys()]).toEqual(['prover-ready'])
    c.handlers.clear()
    const next = clientFromConfig(config).new(
      c,
      id,
      LedgerId.decode('test:testnet'),
      'google',
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
        { ...config, platforms: { ...config.platforms, future: null } },
        'https://bridge.test',
      ).platforms,
    ).toEqual(config.platforms)
    expect(() =>
      validateCeremonyConfig(
        { ...config, platforms: { google: { clientId: 'x'.repeat(129), ceremonyVersions: [1] } } },
        'https://bridge.test',
      ),
    ).toThrow()
  })
  it('validates configuration without coupling Bridge and CCDP [LIBID-OAUTH-001]', () => {
    expect(validateCeremonyConfig(config, 'https://bridge.test').ccdpOrigin).toBe(
      'https://ccdp.test',
    )
    for (const patch of [
      { ccdpOrigin: 'https://ccdp.test/' },
      { redirectUri: 'https://elsewhere.test/callback' },
      { allowedAppOrigins: [] },
    ])
      expect(() => validateCeremonyConfig({ ...config, ...patch }, 'https://bridge.test')).toThrow()
  })
})

it('rejects a duplicate live ID without coercing boxed strings [KIT-008]', async () => {
  const client = clientFromConfig(config),
    input = {
      connection: new Connection(),
      ledgerId: LedgerId.decode('test:testnet'),
      platformId: 'google' as const,
      operationDomain: new Uint8Array(32),
      transactionData: new Uint8Array(),
    }
  const first = client.new(
    input.connection,
    id,
    input.ledgerId,
    input.platformId,
    input.operationDomain,
    input.transactionData,
  )
  expect(() =>
    client.new(
      new Connection(),
      id,
      input.ledgerId,
      input.platformId,
      input.operationDomain,
      input.transactionData,
    ),
  ).toThrow('already live')
  expect(() =>
    client.new(
      input.connection,
      Object(id) as string,
      input.ledgerId,
      input.platformId,
      input.operationDomain,
      input.transactionData,
    ),
  ).toThrow()
  await first.cancel()
  expect(() =>
    client.new(
      input.connection,
      id,
      input.ledgerId,
      input.platformId,
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
          { ...config, platforms: { [platform]: { clientId, ceremonyVersions: [1] } } },
          'https://bridge.test',
        ),
      ).toThrow()
  expect(() =>
    validateCeremonyConfig(
      { ...config, platforms: { google: { clientId: 'a+b', ceremonyVersions: [1] } } },
      'https://bridge.test',
    ),
  ).not.toThrow()
})

it.each(['test:mainnet', 'test:testnet'])(
  'captures the encoded ledger once and derives its hash from the shared decoder: %s [LIBID-MOD-015]',
  async (encoded) => {
    const ledgerId = {
      encode: vi.fn(() => encoded),
      hash: vi.fn(() => {
        throw new Error('must use the shared decoder')
      }),
      isTestnet: vi.fn(() => {
        throw new Error('must use the shared decoder')
      }),
    }
    const connection = new Connection()
    const ceremony = clientFromConfig(config).new(
      connection,
      id,
      ledgerId,
      'google',
      new Uint8Array(32),
      new Uint8Array([1, 2]),
    )
    expect(ledgerId.encode).toHaveBeenCalledOnce()
    expect(ledgerId.hash).not.toHaveBeenCalled()
    expect(ledgerId.isTestnet).not.toHaveBeenCalled()
    ledgerId.encode.mockImplementation(() => {
      throw new Error('must not reread')
    })
    const pending = ceremony.proveUserIdentity()
    connection.receive({ type: 'prefetch-started' })
    const authorization = new URL(connection.navigateAway.mock.calls[0][0])
    connection.receive({ type: 'prover-ready' })
    expect(connection.send.mock.calls[0][0]).toMatchObject({ ledgerId: encoded })
    expect(connection.send.mock.calls[0][0]).not.toHaveProperty('isTestnet')
    expect(connection.send.mock.calls[0][0]).not.toHaveProperty('chainId')
    connection.receive({ type: 'prover-identity-proof', identity, proof })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected proof')
    expect(authorization.searchParams.get('nonce')).toBe(
      b64urlEncode(
        deriveAuthorizationDigest({
          chainId: LedgerId.decode(encoded).hash(),
          operationDomain: new Uint8Array(32),
          transactionData: new Uint8Array([1, 2]),
          platformCeremonyVersion: 1,
          authorizationNonce: result.oauthProof.authorizationNonce,
        }),
      ),
    )
    expect(result.oauthProof).not.toHaveProperty('isTestnet')
  },
)
it('rejects malformed ledger encodings before OAuth [LIBID-MOD-014]', () => {
  const connection = new Connection()
  const input = {
    connection,
    ledgerId: LedgerId.decode('test:mainnet'),
    platformId: 'google' as const,
    operationDomain: new Uint8Array(32),
    transactionData: new Uint8Array(),
  }
  const client = clientFromConfig(config)
  for (const ledgerId of [
    null,
    {},
    { encode: 1 },
    ...[null, undefined, 1, {}, '', 'test:MAINNET', 'unknown:1'].map((value) => ({
      encode: () => value,
    })),
    {
      encode: () => {
        throw new Error('encoding failure')
      },
    },
  ])
    expect(() =>
      client.new(
        connection,
        id,
        ledgerId as LedgerId,
        input.platformId,
        input.operationDomain,
        input.transactionData,
      ),
    ).toThrow()
  expect(connection.navigate).not.toHaveBeenCalled()
  expect(connection.navigateAway).not.toHaveBeenCalled()
})

it('rejects malformed decoded hashes before OAuth [LIBID-MOD-014]', () => {
  const connection = new Connection(),
    ledgerId = LedgerId.decode('test:mainnet')
  const decode = vi.spyOn(LedgerId, 'decode')
  try {
    for (const hash of [null, [], new Uint8Array(31), new Uint8Array(33)]) {
      decode.mockReturnValueOnce({ ...ledgerId, hash: () => hash } as LedgerId)
      expect(() =>
        clientFromConfig(config).new(
          connection,
          id,
          ledgerId,
          'google',
          new Uint8Array(32),
          new Uint8Array(),
        ),
      ).toThrow('Ledger hash must be 32 bytes')
    }
    expect(connection.navigate).not.toHaveBeenCalled()
  } finally {
    decode.mockRestore()
  }
})

it.each([
  { ...identity, platformId: 'x' },
  { ...identity, oauthClientId: 'other-client' },
  { ...identity, userId: '1'.repeat(32) },
])('rejects a profile or client identity mismatch [LIBID-OAUTH-022]', async (identity) => {
  const { connection, ceremony } = setup()
  const result = ceremony.proveUserIdentity()
  connection.receive({ type: 'prefetch-started' })
  connection.receive({ type: 'prover-ready' })
  connection.receive({ type: 'prover-identity-proof', identity, proof })
  await expect(result).rejects.toThrow('sequence')
})

// Compile-only API checks: rejected forms must remain rejected by TypeScript.
function checkCreationTypes() {
  const client = clientFromConfig(config)
  const conn = new Connection(),
    ledger = LedgerId.decode('test:testnet'),
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
  client.new(conn, id, ledger, 'google', bytes)
  // @ts-expect-error Connection and ceremony ID have incompatible positions.
  client.new(id, conn, ledger, 'google', bytes, bytes)
  void client
    .new(conn, id, ledger, 'google', bytes, bytes)
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
