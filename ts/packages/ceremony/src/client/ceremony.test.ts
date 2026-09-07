import { describe, expect, it, vi } from 'vitest'
import type { Message, MessageType, PopupConnection } from '@libid/popup'
import { clientFromConfig } from './ceremony.js'
import { validateCeremonyConfig } from './config.js'
class Connection implements PopupConnection<Message> {
  ready = Promise.resolve()
  closed = new Promise<never>(() => {})
  send = vi.fn()
  navigate = vi.fn(async (_url: string, _fragment?: URLSearchParams) => {})
  navigateAway = vi.fn(async () => {})
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
  const ceremony = clientFromConfig(config).new(id, {
    connection,
    chainId: new Uint8Array(32),
    platformId: 'google',
    operationDomain: new Uint8Array(32),
    transactionData: data,
  })
  return { connection, ceremony, data }
}
const proof = {
  identity: { platformId: 'google', oauthClientId: 'client', userId: '1', userName: 'a@b.c' },
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
    })
    c.receive({ type: 'prover-deliver-proof', proof })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected accepted')
    expect(result.oauthProof.transactionData).toEqual(new Uint8Array([1, 2]))
    expect(result.oauthProof.proof.identityProof).toEqual(new Uint8Array([1]))
    expect(events).toEqual(['authorization', 'proof-generation'])
    expect(c.close).not.toHaveBeenCalled()
    c.receive({ type: 'prover-deliver-proof', proof })
    expect(events).toEqual(['authorization', 'proof-generation'])
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('one-shot')
  })
  it('cancellation wins over late delivery and preserves the popup [LIBID-BROWSER-005]', async () => {
    const { connection: c, ceremony } = setup()
    const result = ceremony.proveUserIdentity()
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await ceremony.cancel()
    c.receive({ type: 'prover-deliver-proof', proof })
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
    const next = clientFromConfig(config).new(id, {
      connection: c,
      chainId: new Uint8Array(32),
      platformId: 'google',
      operationDomain: new Uint8Array(32),
      transactionData: new Uint8Array(),
    })
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
      chainId: new Uint8Array(32),
      platformId: 'google' as const,
      operationDomain: new Uint8Array(32),
      transactionData: new Uint8Array(),
    }
  const first = client.new(id, input)
  expect(() => client.new(id, { ...input, connection: new Connection() })).toThrow('already live')
  expect(() => client.new(Object(id) as string, input)).toThrow()
  await first.cancel()
  expect(() => client.new(id, input)).not.toThrow()
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
