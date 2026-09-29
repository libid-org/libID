import type { LedgerId } from '@libid/ledger'
import { mainnet, testnet } from '@libid/ledger/testing'
import { type Message, type MessageType, PopupError } from '@libid/popup'
import { type FakeConnection, fakeConnection } from '@libid/popup/testing'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { CeremonyError } from '../../errors.js'
import type { CeremonyEvent } from '../../events.js'
import { LIBID_RS_ATTESTED_DATA } from '../../notary/fixtures/libid-rs.js'
import { deriveAuthorizationDigest, deriveCodeChallenge } from '../../platforms/authorization.js'
import { buildGooglePublicInputs } from '../../platforms/google/1/publicInputs.js'
import {
  type Identity,
  type PlatformId,
  platforms,
  type SupportedCeremonyVersion,
  supportedPlatforms,
} from '../../platforms/index.js'
import { b64urlDecode, b64urlEncode } from '../../primitives.js'
import { CEREMONY_ID, fixtures, platformConfig } from '../../testing/index.js'
import { CeremonyFailed, EventMessage, IdentityProof, UserDenied } from '../index.js'
import { popupErrorMessages } from '../ui-messages.js'
import { type CCDPClient, ccdpClientFromConfig, createCCDPClient } from './ceremony.js'
import { fetchCeremonyConfig, validateCeremonyConfig } from './config.js'

type Spied = FakeConnection & Record<'send' | 'navigate' | 'navigateAway' | 'close', Mock>

/** The shared connection double, with spies on the outbound calls tests count or replace. */
function spiedConnection(): Spied {
  const connection = fakeConnection({ peerOrigin: 'https://ccdp.test' })
  for (const method of ['send', 'navigate', 'navigateAway', 'close'] as const)
    vi.spyOn(connection, method)
  return connection as Spied
}

const id = CEREMONY_ID

const wireConfig = {
  ccdpOrigin: 'https://ccdp.test',
  platforms: { google: { clientId: 'client', ceremonyVersions: [1] } },
}

const config = validateCeremonyConfig(wireConfig, 'https://bridge.test')

/** A run on a fresh spied connection: Google version 1, transaction data [1, 2] by default. */
function setup<P extends PlatformId = 'google'>({
  client = ccdpClientFromConfig(config),
  connection = spiedConnection(),
  platformId = 'google' as P,
  ledgerId = testnet,
  transactionData = new Uint8Array([1, 2]),
  version,
}: {
  client?: CCDPClient
  connection?: Spied
  platformId?: P
  ledgerId?: LedgerId
  transactionData?: Uint8Array
  version?: SupportedCeremonyVersion<P>
} = {}) {
  const ceremony = client.new(
    connection,
    id,
    platformId,
    ledgerId,
    new Uint8Array(32),
    transactionData,
    version,
  )
  return { connection, ceremony, data: transactionData }
}

/** A CCDP event message, as the CCDP documents send readiness and observations. */
const event = (event: string, phase?: 'started' | 'finished', timestamp = 1) => ({
  type: 'event',
  event,
  ...(phase ? { phase } : {}),
  timestamp,
})

/** Prefetch readiness releases the authorization navigation. */
const prefetched = (connection: FakeConnection) =>
  connection.receive(event('prefetch-dispatch', 'finished', 1))

/** Prefetch, then Prover readiness, which releases the ProveIdentity request. */
function reachProving(connection: FakeConnection) {
  prefetched(connection)
  connection.receive(event('prover', 'started', 3))
}

/** The provider authorization URL: the run's one navigation away from the CCDP. */
function authorizationUrl(connection: FakeConnection) {
  const away = connection.navigations.filter((navigation) => navigation.away)
  expect(away).toHaveLength(1)
  return new URL(away[0].url)
}

/** The nonce a provider must carry for a run over `transactionData`. */
const expectedNonce = (
  authorizationNonce: Uint8Array,
  transactionData: Uint8Array,
  platformCeremonyVersion = 1,
) =>
  b64urlEncode(
    deriveAuthorizationDigest({
      chainId: testnet.hash(),
      operationDomain: new Uint8Array(32),
      transactionData,
      platformCeremonyVersion,
      authorizationNonce,
    }),
  )

const inbound: MessageType<Message>[] = [EventMessage, IdentityProof, UserDenied, CeremonyFailed]

/** The CCDP message types with a handler on `connection`, probed through its one-handler rule. */
const registered = (connection: FakeConnection) =>
  inbound
    .filter((type) => {
      try {
        connection.on(type, () => {})()
        return false
      } catch {
        return true
      }
    })
    .map(({ type }) => type)

const identity = {
  platformId: 'google' as const,
  oauthClientId: 'client',
  userId: '1',
  userName: 'a@b.c',
}

function proofFor(connection: FakeConnection, claimed: Identity<'google'> = identity) {
  const url = connection.navigations.filter((navigation) => navigation.away).at(-1)?.url
  const digest = url ? b64urlDecode(new URL(url).searchParams.get('nonce')!)! : new Uint8Array(32)
  const fields = { tokenExpiresAt: 42, signingKeyModulus: new Uint8Array(256) }
  return {
    identityProof: new Uint8Array([1]),
    ...fields,
    publicInputs: buildGooglePublicInputs(digest, claimed, fields),
  }
}

describe('Client [LIBID-MOD-014] [LIBID-OAUTH-021] [LIBID-PROVER-021]', () => {
  it('uses distinct origins and frozen input; never receives raw OAuth return [TEST-CCDP-01] [TEST-CCDP-03]', async () => {
    const { connection: c, ceremony, data } = setup()
    const events: string[] = []
    ceremony.onEvent((e) => events.push(e.status === 'active' ? `${e.event}.${e.phase}` : e.status))
    data[0] = 9
    const pending = ceremony.proveUserIdentity()
    const [prefetch] = c.navigations
    expect(prefetch).toMatchObject({ url: 'https://ccdp.test/ccdp/v1/prefetch', away: false })
    expect(`${prefetch.url}#${prefetch.fragment}`).toBe(ceremony.launchUrl)
    prefetched(c)
    expect(c.navigations.map((navigation) => navigation.away)).toEqual([false, true])
    c.receive(event('prover', 'started', 3))
    expect(c.sent).toEqual([
      {
        type: 'prove-identity',
        platformId: 'google',
        platformCeremonyVersion: 1,
        clientId: 'client',
        redirectUri: config.redirectUri,
        codeVerifier: null,
        notaryAddress: testnet.notaryAddress(),
      },
    ])
    c.receive({ type: 'identity-proof', identity, proof: proofFor(c) })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected accepted')
    expect(result.identity).toBe(identity)
    expect(Object.keys(result.oauthProof)).toEqual([
      'platformCeremonyVersion',
      'authorizationNonce',
      'authorizationDigest',
      'proof',
      'expiresAt',
    ])
    expect(result.oauthProof.expiresAt).toBe(42)
    expect(result.oauthProof.authorizationDigest).toEqual(
      deriveAuthorizationDigest({
        chainId: testnet.hash(),
        operationDomain: new Uint8Array(32),
        transactionData: new Uint8Array([1, 2]),
        platformCeremonyVersion: 1,
        authorizationNonce: result.oauthProof.authorizationNonce,
      }),
    )
    expect(result.oauthProof.authorizationDigest).toHaveLength(32)
    const authorization = authorizationUrl(c)
    expect(authorization.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(authorization.searchParams.get('nonce')).toBe(
      expectedNonce(result.oauthProof.authorizationNonce, new Uint8Array([1, 2])),
    )
    expect(result.oauthProof.proof.identityProof).toEqual(new Uint8Array([1]))
    const lifecycle = [
      'prefetch-dispatch.started',
      'prefetch-dispatch.finished',
      'authorization.started',
      'prover.started',
      'completed',
    ]
    expect(events).toEqual(lifecycle)
    expect(c.close).not.toHaveBeenCalled()
    c.receive({ type: 'identity-proof', identity, proof: proofFor(c) })
    expect(events).toEqual(lifecycle)
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('one-shot')
  })
  it('closing the connection wins over late delivery without a CCDP cancel [LIBID-BROWSER-005]', async () => {
    const { connection: c, ceremony } = setup()
    const rejection = expect(ceremony.proveUserIdentity()).rejects.toBeInstanceOf(CeremonyError)
    await c.close()
    c.receive({ type: 'identity-proof', identity, proof: proofFor(c) })
    await rejection
    expect(c.close).toHaveBeenCalledOnce()
    expect(c.sent).toEqual([])
  })
  it('protocol CeremonyFailed remains a failure even with cancellation-like text [LIBID-OAUTH-022]', async () => {
    const { connection, ceremony } = setup()
    const events: CeremonyEvent[] = []
    ceremony.onEvent((event) => events.push(event))
    const result = ceremony.proveUserIdentity()
    connection.receive({
      type: 'ceremony-failed',
      event: 'authorization',
      message: 'Ceremony canceled',
    })
    await expect(result).rejects.toBeInstanceOf(CeremonyError)
    expect(events.at(-1)).toMatchObject({ status: 'failed', event: 'authorization' })
  })
  const prefetchReady = event('prefetch-dispatch', 'finished')
  const ready = [prefetchReady, event('prover', 'started', 3)]
  const preparing = event('zk-proof-preparation', 'started', 4)
  it.each([
    { name: 'Prover before Prefetch', at: 'prefetch-dispatch', messages: [ready[1]] },
    {
      name: 'unfinished Prefetch',
      at: 'prefetch-dispatch',
      messages: [event('prefetch-dispatch', 'started')],
    },
    { name: 'repeated Prefetch', at: 'authorization', messages: [prefetchReady, prefetchReady] },
    {
      name: 'unfinished authorization',
      at: 'authorization',
      messages: [prefetchReady, event('authorization', 'started', 2)],
    },
    {
      name: 'finished Prover readiness',
      at: 'authorization',
      messages: [prefetchReady, event('prover', 'finished', 3)],
    },
    { name: 'proof work before Prover', at: 'authorization', messages: [prefetchReady, preparing] },
    {
      name: 'denial before Prover',
      at: 'authorization',
      messages: [prefetchReady, { type: 'user-denied' }],
    },
    {
      name: 'proof before Prover',
      at: 'authorization',
      messages: [
        prefetchReady,
        { type: 'identity-proof', identity, proof: proofFor(fakeConnection()) },
      ],
    },
    {
      name: 'fallback after Prover',
      at: 'prover',
      messages: [...ready, event('prover-fallback', undefined, 4)],
    },
    {
      name: 'another platform operation',
      at: 'prover',
      messages: [...ready, event('token-fetch', 'started', 4)],
    },
    { name: 'repeated core occurrence', at: 'prover', messages: [...ready, preparing, preparing] },
    {
      name: 'core finish before start',
      at: 'prover',
      messages: [...ready, event('zk-proof-generation', 'finished', 4)],
    },
    {
      name: 'denial after proof work',
      at: 'prover',
      messages: [...ready, preparing, { type: 'user-denied' }],
    },
  ])('rejects invalid predecessors: $name [TEST-CCDP-05]', async ({ at, messages }) => {
    const { connection: c, ceremony } = setup()
    const pending = ceremony.proveUserIdentity()
    for (const message of messages) c.receive(message)
    await expect(pending).rejects.toMatchObject({
      name: 'CeremonyError',
      event: at,
      message: expect.stringContaining('sequence'),
    })
  })
  it('denial resolves only after start; observer failure is inert [TEST-CCDP-07]', async () => {
    const { connection: c, ceremony } = setup()
    ceremony.onEvent(() => {
      throw new Error('observer')
    })
    const pending = ceremony.proveUserIdentity()
    reachProving(c)
    c.receive({ type: 'user-denied' })
    await expect(pending).resolves.toEqual({ status: 'denied' })
  })
  it('rejects setup failures without leaking handlers or connection ownership', async () => {
    const { connection: c, ceremony } = setup()
    const release = c.on(EventMessage, () => {})
    await expect(ceremony.proveUserIdentity()).rejects.toThrow('initialize')
    expect(registered(c)).toEqual(['event'])
    release()
    const result = setup({
      connection: c,
      transactionData: new Uint8Array(),
    }).ceremony.proveUserIdentity()
    expect(registered(c)).toEqual(['event', 'identity-proof', 'user-denied', 'ceremony-failed'])
    const rejection = expect(result).rejects.toMatchObject({
      name: 'CeremonyError',
      status: 'closed',
    })
    await c.close()
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
        const local = { ...wireConfig, ccdpOrigin }
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
      { callbackPath: '/auth/callback' },
      { redirectUri: 'https://bridge.test/auth/callback' },
      { allowedAppOrigins: [] },
    ])
      expect(() =>
        validateCeremonyConfig({ ...wireConfig, ...patch }, 'https://bridge.test'),
      ).toThrow()
  })
})

it('rejects a duplicate live ID without coercing boxed strings [KIT-008]', async () => {
  const client = ccdpClientFromConfig(config)
  const { connection, ceremony: first } = setup({ client })
  expect(() => setup({ client })).toThrow('already live')
  const boxed = Object(id) as string
  expect(() =>
    client.new(connection, boxed, 'google', testnet, new Uint8Array(32), new Uint8Array()),
  ).toThrow()
  const rejected = expect(first.proveUserIdentity()).rejects.toBeInstanceOf(CeremonyError)
  await connection.close()
  await rejected
  expect(() => setup({ client, connection })).not.toThrow()
})

it.each(supportedPlatforms)(
  'snapshots ledger hash and routing once for %s [LIBID-MOD-014/015]',
  async (platformId) => {
    const oidc = fixtures[platformId].pipeline === 'oidc'
    const hash = testnet.hash(),
      domain = new Uint8Array(32),
      data = new Uint8Array([1, 2])
    const ledger = {
      hash: vi.fn(() => hash),
      notaryAddress: vi.fn(() => 'https://local-notary.test:8443'),
    }
    const connection = spiedConnection()
    const ceremony = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: platformConfig(platformId) },
    }).new(connection, id, platformId, ledger, domain, data)
    expect(ledger.hash).toHaveBeenCalledOnce()
    expect(ledger.notaryAddress).toHaveBeenCalledOnce()
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
    expect(message.notaryAddress).toBe('https://local-notary.test:8443')
    if (oidc) {
      expect(message.codeVerifier).toBeNull()
      expect(authorization.searchParams.has('code_challenge')).toBe(false)
    } else {
      expect(message.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(authorization.searchParams.get('code_challenge')).toBe(
        deriveCodeChallenge(message.codeVerifier),
      )
    }
    for (const key of ['ledgerId', 'chainId', 'isTestnet']) expect(message).not.toHaveProperty(key)
    // Every platform delivers an accepted result bound to the retained client digest.
    const { identity: claimed } = fixtures[platformId]
    const attestation = {
      attestedData: LIBID_RS_ATTESTED_DATA.slice(),
      signature: new Uint8Array(65),
    }
    connection.receive({
      type: 'identity-proof',
      identity: claimed,
      proof:
        claimed.platformId === 'google'
          ? proofFor(connection, claimed)
          : {
              bearerLinkProof: new Uint8Array([1]),
              tokenAttestation: attestation,
              identityAttestation: attestation,
            },
    })
    const result = await pending
    if (result.status !== 'accepted') throw new Error('Expected proof')
    const expectedDigest = deriveAuthorizationDigest({
      chainId: testnet.hash(),
      operationDomain: new Uint8Array(32),
      transactionData: new Uint8Array([1, 2]),
      platformCeremonyVersion: 1,
      authorizationNonce: result.oauthProof.authorizationNonce,
    })
    expect(result.oauthProof.authorizationDigest).toEqual(expectedDigest)
    if (oidc) expect(authorization.searchParams.get('nonce')).toBe(b64urlEncode(expectedDigest))
  },
)

it('rejects missing, throwing or malformed hash methods before OAuth [LIBID-MOD-014]', () => {
  const connection = spiedConnection()
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

it.each(supportedPlatforms)(
  'rejects invalid notary addresses before OAuth for %s [LIBID-OAUTH-021]',
  (platformId) => {
    const connection = spiedConnection()
    const client = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: platformConfig(platformId) },
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
  reachProving(connection)
  connection.receive({ type: 'identity-proof', identity, proof: proofFor(connection) })
  // Result validation keeps its own text; only ordering violations are sequence errors.
  await expect(result).rejects.toMatchObject({
    name: 'CeremonyError',
    event: 'prover',
    message: expect.not.stringContaining('sequence'),
  })
})

it('rejects a Google proof bound to another authorization before resolving or announcing success [LIBID-OAUTH-014]', async () => {
  const { connection, ceremony } = setup()
  const statuses: string[] = []
  ceremony.onEvent((event) => statuses.push(event.status))
  const result = ceremony.proveUserIdentity()
  reachProving(connection)
  // Every other binding mismatch is the platform's conformance matrix.
  const { proof } = fixtures.google.rejectedBinding['authorization digest']({
    identity,
    proof: proofFor(connection),
  })
  connection.receive({ type: 'identity-proof', identity, proof })
  await expect(result).rejects.toMatchObject({
    name: 'CeremonyError',
    event: 'prover',
    message: 'Google public input mismatch',
  })
  expect(statuses.filter((status) => status !== 'active')).toEqual(['failed'])
})

it('keeps transport failure text instead of reporting it as an invalid sequence', async () => {
  const { connection, ceremony } = setup()
  connection.send.mockImplementation(() => {
    throw new PopupError('send-unavailable')
  })
  const result = ceremony.proveUserIdentity()
  reachProving(connection)
  await expect(result).rejects.toMatchObject({
    event: 'prover',
    message: popupErrorMessages['send-unavailable'],
    cause: expect.any(PopupError),
  })
})

it('keeps the Prefetch navigation error like the authorization navigation error', async () => {
  const { connection, ceremony } = setup()
  connection.navigate.mockRejectedValueOnce(new PopupError('keep-failed'))
  await expect(ceremony.proveUserIdentity()).rejects.toMatchObject({
    event: 'prefetch-dispatch',
    message: popupErrorMessages['keep-failed'],
  })
})

// Compile-only API checks: rejected forms must remain rejected by TypeScript.
function checkCreationTypes() {
  const client = ccdpClientFromConfig(config)
  const conn = spiedConnection(),
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
    type: 'ceremony-failed',
    event: 'authorization',
    message: 'Invalid OAuth return or provider authorization error.',
  })
  await expect(result).rejects.toMatchObject({
    name: 'CeremonyError',
    event: 'authorization',
    message: 'Invalid OAuth return or provider authorization error.',
  })
})

it.each(supportedPlatforms)(
  'projects %s stages without delaying or summing overlapping work [LIBID-BROWSER-007]',
  async (platformId) => {
    const notarized = fixtures[platformId].pipeline === 'bearer-link'
    const c = spiedConnection()
    const ceremony = ccdpClientFromConfig({
      ...config,
      platforms: { [platformId]: platformConfig(platformId) },
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
    if (notarized) emit('token-fetch', 'started', 50)
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
      ...(notarized ? ['notarization'] : []),
      'zk-proving',
    ])
    const rejection = expect(result).rejects.toMatchObject({ name: 'CeremonyError' })
    await c.close()
    await rejection
    expect(events.at(-1)).toMatchObject({ status: 'closed' })
    expect(
      events.some(
        (e) => 'event' in e && e.event === 'prover' && 'phase' in e && e.phase === 'finished',
      ),
    ).toBe(false)
  },
)

it.each(['success', 'denied', 'failed', 'closed', 'invalid-result', 'setup'] as const)(
  'finishes exactly once for %s, before settling the promise [LIBID-BROWSER-008]',
  async (outcome) => {
    const { ceremony, connection } = setup()
    const finish = {
      success: () =>
        connection.receive({ type: 'identity-proof', identity, proof: proofFor(connection) }),
      'invalid-result': () => connection.receive({ type: 'identity-proof', identity, proof: {} }),
      denied: () => connection.receive({ type: 'user-denied' }),
      closed: () => connection.close(),
      failed: () =>
        connection.receive({
          type: 'ceremony-failed',
          event: 'zk-proof-generation',
          message: 'Proof engine failed.',
        }),
    }
    const status = {
      success: 'completed',
      'invalid-result': 'failed',
      setup: 'failed',
      denied: 'denied',
      closed: 'closed',
      failed: 'failed',
    }[outcome]
    if (outcome === 'setup') connection.on(EventMessage, () => {})
    const events: CeremonyEvent[] = []
    let settled = false
    const settledAtFinish: boolean[] = []
    ceremony.onEvent((event) => {
      events.push(event)
      if (event.status !== 'active') {
        settledAtFinish.push(settled)
        // Observer reentry must not turn a success into cancellation or emit twice.
        void connection.close()
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
      reachProving(connection)
      await finish[outcome]()
    }
    await result
    await connection.close()
    connection.receive({ type: 'identity-proof', identity, proof: proofFor(connection) })
    await connection.close()
    expect(events.filter((e) => e.status !== 'active')).toEqual([
      expect.objectContaining({ status }),
    ])
    expect(events.at(-1)?.status).not.toBe('active')
    expect(settledAtFinish).toEqual([false])
    if (outcome === 'failed') expect(events.at(-1)).toMatchObject({ event: 'zk-proof-generation' })
  },
)

it('closure terminates the feed and late messages cannot revive it [TEST-CCDP-08]', async () => {
  const { ceremony, connection } = setup()
  const events: CeremonyEvent[] = []
  ceremony.onEvent((event) => events.push(event))
  const result = ceremony.proveUserIdentity()
  const rejection = expect(result).rejects.toBeInstanceOf(CeremonyError)
  await connection.close()
  await rejection
  const count = events.length
  const late = vi.fn()
  const unsubscribe = [ceremony.onEvent(late), ceremony.onStage(late)]
  connection.receive(event('prover', 'started', 2))
  connection.receive({ type: 'user-denied' })
  connection.receive({ type: 'identity-proof', identity, proof: proofFor(connection) })
  expect(events).toHaveLength(count)
  expect(events.at(-1)).toMatchObject({ status: 'closed' })
  expect(late).not.toHaveBeenCalled()
  for (const off of unsubscribe) off()
  expect(connection.sent).toEqual([])
})

it('only core readiness events advance the protocol; preserves occurrence times [LIBID-BROWSER-006] [TEST-CCDP-06]', async () => {
  const { ceremony, connection: c } = setup()
  const events: CeremonyEvent[] = []
  ceremony.onEvent((e) => events.push(e))
  const result = ceremony.proveUserIdentity()
  c.receive(event('extension-ready'))
  expect(c.navigateAway).not.toHaveBeenCalled()
  c.receive(event('prefetch-dispatch', 'finished', 2))
  c.receive(event('authorization', 'finished', 3))
  c.receive(event('prover-fallback', undefined, 4))
  expect(c.sent).toEqual([])
  c.receive(event('prover', 'started', 7))
  c.receive({ type: 'user-denied' })
  await expect(result).resolves.toEqual({ status: 'denied' })
  expect(events).toContainEqual({ event: 'prover-fallback', timestamp: 4, status: 'active' })
  expect(events).toContainEqual({
    event: 'prover',
    phase: 'started',
    timestamp: 7,
    status: 'active',
  })
  const count = events.length
  c.receive(event('late', undefined, 9))
  expect(events).toHaveLength(count)
})

it('cancellation at authorization entry prevents provider navigation', async () => {
  const { ceremony, connection } = setup()
  ceremony.onEvent((event) => {
    if (event.status === 'active' && event.event === 'authorization' && event.phase === 'started')
      void connection.close()
  })
  const result = ceremony.proveUserIdentity()
  prefetched(connection)
  await expect(result).rejects.toMatchObject({ name: 'CeremonyError' })
  // Only the Prefetch navigation happened; the closed connection refused to navigate away.
  expect(connection.navigations.map((navigation) => navigation.away)).toEqual([false])
})

it('readiness without the optional authorization observation still permits denial', async () => {
  const { ceremony, connection: c } = setup()
  const stages: string[] = []
  ceremony.onStage((e) => stages.push(e.stage))
  const events: CeremonyEvent[] = []
  ceremony.onEvent((e) => events.push(e))
  const result = ceremony.proveUserIdentity()
  reachProving(c)
  c.receive({ type: 'user-denied' })
  await expect(result).resolves.toEqual({ status: 'denied' })
  expect(events.at(-1)).toMatchObject({ status: 'denied' })
  expect(stages).toContain('proof-preparation')
})

it('discovers compatible versions and honors explicit selection [LIBID-MOD-015] [LIBID-MOD-020] [TEST-PLAT-17]', async () => {
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
    expect(() => setup({ client: onlyNewer, version: 1 })).toThrow('Unsupported ceremony version')
    for (const selected of [1, undefined] as const) {
      const transactionData = new Uint8Array()
      const { connection: c, ceremony: run } = setup({ client, transactionData, version: selected })
      const version = selected ?? 2
      expect(new URLSearchParams(new URL(run.launchUrl).hash.slice(1)).get('ceremonyVersion')).toBe(
        String(version),
      )
      const pending = run.proveUserIdentity()
      reachProving(c)
      expect(c.sent).toEqual([expect.objectContaining({ platformCeremonyVersion: version })])
      c.receive({ type: 'identity-proof', identity, proof: proofFor(c) })
      const result = await pending
      expect(result).toMatchObject({ oauthProof: { platformCeremonyVersion: version } })
      if (result.status !== 'accepted') throw new Error('Expected proof')
      expect(authorizationUrl(c).searchParams.get('nonce')).toBe(
        expectedNonce(result.oauthProof.authorizationNonce, transactionData, version),
      )
    }
  } finally {
    Reflect.deleteProperty(platforms.google.versions, '2')
  }
})

it('rejects unavailable explicit versions before reading ledger or reserving the run [LIBID-MOD-015]', async () => {
  const client = ccdpClientFromConfig(config)
  const ledger = { ...testnet, hash: vi.fn(testnet.hash) }
  const c = spiedConnection()
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
  expect(registered(c)).toEqual([])
  client.new(c, id, 'google', ledger, new Uint8Array(32), new Uint8Array(), 1)
  await c.close()
})

it('a lost optional operation start does not prevent accepted proof delivery [LIBID-BROWSER-008]', async () => {
  const { ceremony, connection: c } = setup()
  const result = ceremony.proveUserIdentity()
  reachProving(c)
  c.receive(event('proof', 'finished', 4))
  c.receive({ type: 'identity-proof', identity, proof: proofFor(c) })
  await expect(result).resolves.toMatchObject({ status: 'accepted' })
})

it('reports closure before the first start without mislabeling it as a repeat [LIBID-BROWSER-013]', async () => {
  const { ceremony, connection } = setup()
  await connection.close()
  await expect(ceremony.proveUserIdentity()).rejects.toMatchObject({
    name: 'CeremonyError',
    event: 'prefetch-dispatch',
    message: 'Popup connection ended',
  })
  await expect(ceremony.proveUserIdentity()).rejects.toThrow('one-shot')
  expect(connection.sent).toEqual([])
  expect(connection.navigations).toEqual([])
})

it('freezes and forwards the public credential from validated configuration [TEST-BRIDGE-03]', async () => {
  const profile = {
    clientId: 'client',
    ceremonyVersions: [1],
    clientCredential: 'public&original=1',
  }
  const config = validateCeremonyConfig(
    { ...wireConfig, platforms: { github: profile } },
    'https://bridge.test',
  )
  const client = ccdpClientFromConfig(config)
  profile.clientCredential = 'replacement'
  const { connection, ceremony } = setup({ client, platformId: 'github' })
  const rejected = expect(ceremony.proveUserIdentity()).rejects.toBeInstanceOf(CeremonyError)
  reachProving(connection)
  expect(connection.sent).toEqual([
    expect.objectContaining({ clientCredential: 'public&original=1' }),
  ])
  expect(Object.isFrozen(config.platforms.github)).toBe(true)
  await connection.close()
  await rejected
})

it('requires the GitHub public credential and validates optional credentials for other profiles [TEST-BRIDGE-03]', () => {
  for (const platformId of ['github', 'x', 'google']) {
    const profile = { clientId: 'client', ceremonyVersions: [1] }
    const validate = (value: object) =>
      validateCeremonyConfig(
        { ...wireConfig, platforms: { [platformId]: value } },
        'https://bridge.test',
      )
    if (platformId === 'github') expect(() => validate(profile)).toThrow()
    else expect(() => validate(profile)).not.toThrow()
    expect(() => validate({ ...profile, clientCredential: 'public' })).not.toThrow()
    expect(() =>
      validate({ ...profile, clientCredential: 'public', tokenExchangeCredential: 'retired' }),
    ).toThrow()
    for (const clientCredential of [
      undefined,
      null,
      '',
      1,
      'with space',
      'tail\n',
      'é',
      'x'.repeat(513),
    ])
      expect(() => validate({ ...profile, clientCredential })).toThrow()
  }
})

it.each(['closed', 'failed'] as const)(
  'preserves popup %s in errors and both terminal subscriptions',
  async (outcome) => {
    const { connection, ceremony } = setup()
    const events = vi.fn(),
      stages = vi.fn()
    ceremony.onEvent(events)
    ceremony.onStage(stages)
    const pending = ceremony.proveUserIdentity()
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'CeremonyError',
      status: outcome,
      event: 'prefetch-dispatch',
      ...(outcome === 'failed' ? { cause: { name: 'PopupError', code: 'decode-rejected' } } : {}),
    })
    connection.end(outcome === 'closed' ? { outcome } : { outcome, code: 'decode-rejected' })
    await rejection
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ status: outcome }))
    expect(stages).toHaveBeenLastCalledWith(expect.objectContaining({ status: outcome }))
    expect(connection.sent).toEqual([])
  },
)

it('preserves closure before proving starts', async () => {
  const { connection, ceremony } = setup()
  await connection.close()
  await expect(ceremony.proveUserIdentity()).rejects.toMatchObject({ status: 'closed' })
})

it('fetches configuration once without credentials and bounds its body [LIBID-MOD-011]', async () => {
  const fetch = vi.fn(async () => Response.json(wireConfig))
  vi.stubGlobal('fetch', fetch)
  try {
    await expect(fetchCeremonyConfig('https://bridge.test')).resolves.toEqual(config)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://bridge.test/api/v1/ceremony/config', {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    fetch.mockResolvedValueOnce(Response.json({ ...wireConfig, padding: 'x'.repeat(64 * 1024) }))
    await expect(fetchCeremonyConfig('https://bridge.test')).rejects.toThrow('limit')
    await expect(fetchCeremonyConfig('https://bridge.test/')).rejects.toThrow('oauthBridge')
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(fetchCeremonyConfig('https://bridge.test')).rejects.toThrow('request failed')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('creates a client from fetched configuration, rejecting other options before fetching', async () => {
  const fetch = vi.fn(async () => Response.json(wireConfig))
  vi.stubGlobal('fetch', fetch)
  try {
    await expect(
      // @ts-expect-error Unknown options are rejected at runtime too.
      createCCDPClient({ oauthBridge: 'https://bridge.test', ccdpOrigin: 'https://ccdp.test' }),
    ).rejects.toThrow('Invalid client options')
    expect(fetch).not.toHaveBeenCalled()
    const client = await createCCDPClient({ oauthBridge: 'https://bridge.test' })
    expect(client.enabledPlatforms).toEqual(['google'])
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})

it.each([
  { name: 'short operation domain', operationDomain: new Uint8Array(31), error: '32 bytes' },
  { name: 'long operation domain', operationDomain: new Uint8Array(33), error: '32 bytes' },
  { name: 'operation domain array', operationDomain: Array(32).fill(0), error: '32 bytes' },
  { name: 'transaction data array', transactionData: [1, 2], error: 'transaction bytes' },
  { name: 'transaction data string', transactionData: '0102', error: 'transaction bytes' },
])(
  'rejects malformed operation bytes before OAuth: $name',
  ({ operationDomain = new Uint8Array(32), transactionData = new Uint8Array(), error }) => {
    const client = ccdpClientFromConfig(config)
    const connection = spiedConnection()
    expect(() =>
      client.new(
        connection,
        id,
        'google',
        testnet,
        operationDomain as Uint8Array,
        transactionData as Uint8Array,
      ),
    ).toThrow(error)
    expect(connection.navigations).toEqual([])
    expect(registered(connection)).toEqual([])
    // The rejected call reserved nothing.
    expect(() => setup({ client, connection })).not.toThrow()
  },
)

it('binds one active ceremony per connection and rebinds it once that run finishes', async () => {
  const client = ccdpClientFromConfig(config)
  const { connection, ceremony: first } = setup({ client })
  const second = client.new(
    connection,
    crypto.randomUUID(),
    'google',
    testnet,
    new Uint8Array(32),
    new Uint8Array(),
  )
  const pending = first.proveUserIdentity()
  await expect(second.proveUserIdentity()).rejects.toMatchObject({
    event: 'prefetch-dispatch',
    message: 'Connection already has an active ceremony',
  })
  // That rejection was the refused run's one start.
  await expect(second.proveUserIdentity()).rejects.toThrow('one-shot')
  expect(connection.navigations).toHaveLength(1)
  reachProving(connection)
  connection.receive({ type: 'user-denied' })
  await expect(pending).resolves.toEqual({ status: 'denied' })
  // The finished run's handlers give way instead of failing the next run's setup.
  const next = setup({ client, connection }).ceremony.proveUserIdentity()
  reachProving(connection)
  connection.receive({ type: 'identity-proof', identity, proof: proofFor(connection) })
  await expect(next).resolves.toMatchObject({ status: 'accepted' })
})
