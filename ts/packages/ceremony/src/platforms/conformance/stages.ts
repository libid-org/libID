import { sha256 } from '@noble/hashes/sha2.js'
import { afterEach, expect, vi } from 'vitest'
import { type Asset, assetUrl } from '../../assets/index.js'
import { MAX_BEARER_BYTES } from '../../barretenberg/circuits/bearer-link/parameters.js'
import type { ProofEngineOptions, RawProof } from '../../barretenberg/engine.js'
import { type OAuthReturn, oauthState } from '../../ccdp/navigation.js'
import type { OperationEvent } from '../../events.js'
import { concat, encodeAttestation, opening } from '../../notary/fixtures/attestation.js'
import { correlateReveal, matchAttestedData, planNotarization } from '../../notary/notarize.js'
import type { IdentityRequest } from '../../notary/oauth/identity.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  NotaryAttestation,
  Reveals,
  Transcript,
} from '../../notary/protocol.js'
import { BLINDER_BYTES, NOTARY_SIGNATURE_BYTES } from '../../notary/protocol.js'
import { b64urlEncode } from '../../primitives.js'
import {
  CEREMONY_ID,
  fixtures,
  jwtPart,
  jwtWith,
  type NotarizedPlatform,
  type OidcPlatform,
  proverContext,
  text,
  utf8,
} from '../../testing/index.js'
import type { ProverContext } from '../context.js'
import type { PlatformId } from '../index.js'
import type { ReturnRules } from '../oauthReturn.js'
import { assetsByPlatform, circuits } from '../platforms.assets.js'
import type { ProverModule } from '../provers.js'
import type { PlatformFixture } from './fixtures.js'
import { engine, generate, notarization, prepare } from './mocks.js'

/** A PKCE value of the specification's exact 43 base64url characters (REQ-COMMON-12). */
export const PKCE_VALUE = 'A'.repeat(43)

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

export const state = oauthState(CEREMONY_ID)

/** Text every identity string field and client ID rejects on every platform. */
export const sharedTextRejections = ['', 'a"b', 'é', 'a\nb', 'a\x7fb']

export const overLength = (longest: string) => longest + longest.at(-1)

/** A title followed by any requirement tags. */
export const tagged = (title: string, tags: string) => [title, tags].filter(Boolean).join(' ')

export function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('Expected a failure')
}

/** Nothing past return admission ran: no network, notary session or proof engine. */
export function expectNoProvingWork(fetch: unknown = globalThis.fetch) {
  expect(fetch).not.toHaveBeenCalled()
  expect(notarization).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
  expect(engine).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
}

/** Resources a prover's proof engine loaded must belong to the platform's asset set. */
export function expectEngineAssets(platformId: PlatformId) {
  const assets: readonly Asset[] = assetsByPlatform[platformId][1]
  const urls = assets.map(assetUrl)
  expect(engine).toHaveBeenCalledOnce()
  const [{ circuitUrl, verificationKeyUrl }] = engine.mock.calls[0] as [ProofEngineOptions]
  expect(circuits.map(assetUrl)).toContain(circuitUrl)
  expect(urls).toContain(circuitUrl)
  expect(urls).toContain(verificationKeyUrl)
  expect(verificationKeyUrl).not.toBe(circuitUrl)
}

/** A platform's prover module, widened so one call serves every catalog platform. */
export const proverOf = (platformId: PlatformId): Promise<ProverModule> =>
  fixtures[platformId].prover()

// Return helpers over one platform's return rules: `fields` is the component without its `?`/`#` prefix.
export const fieldsOf = (value: OAuthReturn, rules: ReturnRules) =>
  (rules.transport === 'query' ? value.query : value.fragment).slice(1)

export function returnOf(fields: string, rules: ReturnRules, other = ''): OAuthReturn {
  return rules.transport === 'query'
    ? { query: `?${fields}`, fragment: other && `#${other}` }
    : { query: other && `?${other}`, fragment: `#${fields}` }
}

export const setField = (fields: string, name: string, raw: string) =>
  fields
    .split('&')
    .map((part) => (part.startsWith(`${name}=`) ? `${name}=${raw}` : part))
    .join('&')

export const dropField = (fields: string, name: string) =>
  fields
    .split('&')
    .filter((part) => !part.startsWith(`${name}=`))
    .join('&')

export const kind = (value: unknown) =>
  value === null
    ? 'null'
    : value instanceof Uint8Array
      ? 'bytes'
      : Array.isArray(value)
        ? 'array'
        : typeof value

/** Missing, extra, non-record and wrong-typed variants of one valid exact record. */
export function recordViolations(valid: object, wrong: Record<string, readonly unknown[]> = {}) {
  const record = valid as Record<string, unknown>
  const values = [undefined, null, true, 1, '1', new Uint8Array([1]), [], {}]
  return [
    null,
    [],
    'record',
    new Map(Object.entries(record)),
    Object.assign(Object.create({}), record),
    { ...record, extra: 1 },
    ...Object.keys(record).map((key) =>
      Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)),
    ),
    ...Object.entries(record).flatMap(([key, current]) =>
      [...values.filter((value) => kind(value) !== kind(current)), ...(wrong[key] ?? [])].map(
        (value) => ({ ...record, [key]: value }),
      ),
    ),
  ]
}

/** The request head a notarized HTTP/1.1 session sends for `request`. */
export const requestHead = (request: ExactHttpRequest) =>
  utf8(
    `${request.method} ${new URL(request.url).pathname} HTTP/1.1\r\n${Object.entries(
      request.headers,
    )
      .map(([k, v]) => `${k}: ${text(v)}\r\n`)
      .join('')}\r\n`,
  )

export const phases = (events: OperationEvent[], name: string) =>
  events.filter((event) => event.event === name).map((event) => event.phase)

// Provers: every platform meets one prove() contract, which its prover kind stages; each kind
// then adds the cases only it has.

/** Engine public inputs every prover must reject: reordered, resized, changed, or in noncanonical case. */
export const engineInputChanges = {
  'public-input-order': 'out of order',
  'public-input-extra': 'with an extra field',
  'public-input-short': 'with a missing field',
  'public-input-changed': 'with a changed value',
  'public-input-case': 'in noncanonical case',
}

export type EngineInputChange = keyof typeof engineInputChanges

/** Outcomes every prover kind stages: success, changed engine inputs, startup cancellation. */
export type SharedOutcome = 'accepted' | EngineInputChange | 'startup-cancel'

/** `fields` as a staged engine returns them; each prover reorders them its own way. */
export function changedEngineInputs(fields: string[], outcome: string) {
  if (outcome === 'public-input-extra') return [...fields, fields[0]]
  if (outcome === 'public-input-short') return fields.slice(0, -1)
  if (outcome === 'public-input-changed')
    return [
      ...fields.slice(0, -1),
      `0x${(BigInt(fields.at(-1)!) ^ 1n).toString(16).padStart(64, '0')}`,
    ]
  if (outcome === 'public-input-case')
    return fields.map((field) => `0x${field.slice(2).toUpperCase()}`)
  return fields
}

/** One staged run. `proof` and `untouched` are read after it settles. */
export interface Staged {
  context: ProverContext
  events: OperationEvent[]
  /** Abort the run, as closing its document does. */
  abort(reason: Error): void
  /** The platform proof an accepted run delivers. */
  proof(): unknown
  /** The prover started no request and opened no notary session of its own. */
  untouched(): void
}

/** A run context that records observations and, for `startup-cancel`, aborts at the first. */
export function runContext(
  platformId: PlatformId,
  outcome: string,
  change: Parameters<typeof proverContext>[1] = {},
) {
  const controller = new AbortController()
  const events: OperationEvent[] = []
  const context = proverContext(platformId, {
    signal: controller.signal,
    emit: (event) => {
      events.push(event)
      if (outcome === 'startup-cancel') controller.abort(new Error('Closed during startup'))
    },
    ...change,
  })
  return { context, events, abort: (reason: Error) => controller.abort(reason) }
}

export const notarizedFailures = {
  'identity-shape': 'Invalid identity response',
  'opening-range': 'Plaintext opening is not unique',
  'shifted-range': 'Plaintext opening does not match its commitment',
  'attestation-mismatch': 'attested authority changed',
}

export type NotarizedOutcome = SharedOutcome | keyof typeof notarizedFailures

/**
 * Mutate a selector consistently: both the hidden window and its returned range shift by one
 * byte without changing length, so the notarized commitment covers different bytes.
 */
export function shiftIdentitySelection(identity: IdentityRequest) {
  const select = identity.select
  vi.spyOn(identity, 'select').mockImplementation((value: Transcript, bearer: string) => {
    const selected = select(value, bearer)
    selected.bearerRange.start++
    selected.bearerRange.end++
    selected.ranges.sent[0].end++
    selected.ranges.sent[1].start++
    return selected
  })
}

/**
 * A synthetic TLSN backend over real planning, correlation and attestation encoding. `held` sessions
 * wait on `gates` for the token response, token openings and final token attestation, and `log`
 * records each session call as it happens.
 */
export function fakeNotarization(
  platformId: NotarizedPlatform,
  outcome: NotarizedOutcome,
  held = false,
) {
  const { evidence } = fixtures[platformId]
  const gate = () => {
    const gate = Promise.withResolvers<void>()
    if (!held) gate.resolve()
    return gate
  }
  const gates = { tokenResponse: gate(), tokenOpenings: gate(), tokenAttestation: gate() }
  const log: string[] = []
  const session = (index: number) => (index === 0 ? 'token' : 'identity')
  const attestations: NotaryAttestation[] = []
  const transcripts: Transcript[] = []
  const selected: Reveals[] = []
  const commitments: { sent: Uint8Array[]; received: Uint8Array[] }[] = []
  let sessionCount = 0
  prepare.mockImplementation(async (url: string) => {
    const index = sessionCount++
    let transcript: Transcript
    return {
      async send(request: ExactHttpRequest) {
        log.push(`${session(index)} send`)
        if (index === 0) await gates.tokenResponse.promise
        expect(request.url).toBe(url)
        const body =
          index === 0
            ? evidence.tokenBody
            : outcome === 'identity-shape'
              ? evidence.misshapenIdentityBody
              : evidence.identityBody
        transcript = {
          sent: concat(requestHead(request), request.body),
          received: utf8(
            `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
          ),
        }
        transcripts[index] = transcript
        return transcript
      },
      async reveal(ranges: Reveals) {
        log.push(`${session(index)} reveal`)
        if (index === 0) await gates.tokenOpenings.promise
        selected[index] = ranges
        const plan = planNotarization(transcript, ranges)
        const raw = {
          sent: plan.commit.sent.map((range) => opening(transcript.sent, range, index + 1)),
          received: plan.commit.received.map((range) =>
            opening(transcript.received, range, index + 1),
          ),
        }
        commitments[index] = {
          sent: raw.sent.map((o) => o.hash),
          received: raw.received.map((o) => o.hash),
        }
        const host = new URL(url).hostname
        const attestedData = encodeAttestation(
          transcript,
          plan,
          commitments[index],
          plan.commit,
          host,
        )
        if (outcome === 'attestation-mismatch' && index === 0) attestedData[0] ^= 1
        const correlated = correlateReveal(transcript, plan, raw)
        matchAttestedData(host, transcript, plan, correlated, attestedData)
        const openings: CommitmentOpening[] = (['sent', 'received'] as const).flatMap((direction) =>
          correlated[direction].map((commitment) => ({ direction, ...commitment })),
        )
        if (outcome === 'opening-range' && index === 1) openings[0].start++
        const attestation = {
          attestedData,
          signature: new Uint8Array(NOTARY_SIGNATURE_BYTES).fill(index + 1),
        }
        attestations[index] = attestation
        return {
          openings: openings.reverse(),
          attestation:
            index === 0
              ? gates.tokenAttestation.promise.then(() => attestation)
              : Promise.resolve(attestation),
        }
      },
    }
  })
  return { attestations, transcripts, selected, gates, log }
}

/** The proof engine checks the witness it receives. */
export function fakeBearerProof(bearer: string, outcome: NotarizedOutcome) {
  const hashes = [1, 2].map((byte) =>
    sha256(concat(utf8(bearer), new Uint8Array(BLINDER_BYTES).fill(byte))),
  )
  generate.mockImplementation(async (inputs): Promise<RawProof> => {
    expect(inputs).toEqual({
      bearer: [...utf8(bearer), ...new Uint8Array(MAX_BEARER_BYTES - bearer.length)],
      bearer_len: String(bearer.length),
      blinder_token: Array(16).fill(1),
      blinder_identity: Array(16).fill(2),
      token_commitment: [...hashes[0]],
      identity_commitment: [...hashes[1]],
    })
    const ordered = outcome === 'public-input-order' ? [...hashes].reverse() : hashes
    return {
      proof: new Uint8Array([1]),
      publicInputs: changedEngineInputs(
        ordered.flatMap((hash) => [...hash].map((n) => `0x${n.toString(16).padStart(64, '0')}`)),
        outcome,
      ),
      runtime: { effectiveThreads: 2, sharedMemory: true },
    }
  })
}

/** Stage `outcome`; `held` sessions wait on their gates, and `change` edits the run context. */
export function stageNotarized(
  platformId: NotarizedPlatform,
  outcome: NotarizedOutcome,
  {
    held = false,
    change = {},
  }: { held?: boolean; change?: Parameters<typeof proverContext>[1] } = {},
) {
  const fixture = fixtures[platformId]
  if (outcome === 'shifted-range') shiftIdentitySelection(fixture.requests.identity)
  const notarized = fakeNotarization(platformId, outcome, held)
  fakeBearerProof(fixture.evidence.bearer, outcome)
  return {
    ...runContext(platformId, outcome, change),
    notarized,
    proof: () => ({
      bearerLinkProof: new Uint8Array([1]),
      tokenAttestation: notarized.attestations[0],
      identityAttestation: notarized.attestations[1],
    }),
    untouched: () => expect(prepare).not.toHaveBeenCalled(),
  }
}

export const oidcFailures = {
  'wrong-kid': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  'duplicate-key': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  'empty-key-set': { event: 'signing-key-fetch', message: expect.stringMatching(/signing key/i) },
  expired: { event: 'authorization', message: expect.stringMatching(/token/i) },
  'audience-mismatch': { event: 'authorization', message: expect.stringMatching(/token/i) },
}

export type OidcOutcome = SharedOutcome | keyof typeof oidcFailures

/** Token rejections that must happen before any key fetch or proof engine startup. */
export const beforeProving: OidcOutcome[] = ['expired', 'audience-mismatch']

export function oidcToken(idToken: string, outcome: OidcOutcome) {
  if (outcome === 'wrong-kid')
    return jwtWith(idToken, { header: { ...jwtPart(idToken, 0), kid: 'rotated-key' } })
  return idToken
}

/** An unrelated key published beside the fixture key. */
export const previousKey = {
  kid: 'previous',
  kty: 'RSA',
  e: 'AQAB',
  n: b64urlEncode(new Uint8Array(256).fill(0xff)),
}

/** Publish `published` as the provider's key set. */
export function publishKeys(published: object[]) {
  const keys = vi.fn(async (_url: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    return new Response(JSON.stringify({ keys: published }))
  })
  vi.stubGlobal('fetch', keys)
  return keys
}

/** Stage `outcome`; `change` replaces the signed token or the published fixture key. */
export function stageOidc(
  platformId: OidcPlatform,
  outcome: OidcOutcome,
  change: { idToken?: string; jwk?: Record<string, string> } = {},
) {
  const fixture = fixtures[platformId]
  const { authorizationDigest, publicInputs } = fixture.evidence
  const { idToken = fixture.evidence.idToken, jwk = fixture.evidence.jwk } = change
  const { iat, exp } = jwtPart(fixture.evidence.idToken, 1) as { iat: number; exp: number }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((outcome === 'expired' ? exp : iat) * 1000)
  const keys = publishKeys(
    outcome === 'duplicate-key'
      ? [jwk, jwk]
      : outcome === 'empty-key-set'
        ? []
        : [previousKey, jwk],
  )
  const { config } = fixture
  const run = runContext(platformId, outcome, {
    credential: oidcToken(idToken, outcome),
    request: outcome === 'audience-mismatch' ? { clientId: `other-${config.clientId}` } : {},
  })
  generate.mockImplementation(async (inputs): Promise<RawProof> => {
    expect((inputs as Record<string, unknown>)[fixture.evidence.digestInput]).toEqual([
      ...authorizationDigest,
    ])
    const fields = [...publicInputs]
    if (outcome === 'public-input-order') fields.unshift(...fields.splice(1, 1))
    return {
      proof: new Uint8Array([1]),
      publicInputs: changedEngineInputs(fields, outcome),
      runtime: { effectiveThreads: 2, sharedMemory: true },
    }
  })
  return {
    ...run,
    keys,
    proof: () => fixture.proof,
    untouched: () => {
      expect(keys).not.toHaveBeenCalled()
      expect(notarization).not.toHaveBeenCalled()
    },
  }
}

/**
 * Each prover kind's stage for the shared outcomes, and the requirements its runs cover. A new
 * kind fails typecheck here until it can be staged. The fixture's prover kind selects the stage, so
 * the platform passed to it is of that kind.
 */
export const proverKinds = {
  notarized: {
    stage: (platformId, outcome) => stageNotarized(platformId as NotarizedPlatform, outcome),
    tags: '[LIBID-PROVER-003] [LIBID-PROVER-004] [LIBID-PROVER-009] [LIBID-PROVER-021]',
    // Reported by the notary session this suite replaces; the session's own tests cover them.
    sessionReported: ['token-attestation', 'identity-attestation'],
  },
  oidc: {
    stage: (platformId, outcome) => stageOidc(platformId as OidcPlatform, outcome),
    tags: '[LIBID-PROVER-002] [LIBID-PROVER-021]',
    sessionReported: [],
  },
} satisfies Record<
  PlatformFixture<PlatformId>['proverKind'],
  {
    stage(platformId: PlatformId, outcome: SharedOutcome): Staged
    tags: string
    sessionReported: readonly string[]
  }
>
