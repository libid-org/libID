import { sha256 } from '@noble/hashes/sha2.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProofEngineOptions, RawProof } from '../../barretenberg/engine.js'
import type { NotaryAttestation } from '../../notary/decode.js'
import { concat, encodeAttestation, opening } from '../../notary/fixtures/attestation.js'
import { correlateAttestation, planNotarization } from '../../notary/notarize.js'
import type {
  CommitmentOpening,
  ExactHttpRequest,
  Reveals,
  Transcript,
} from '../../notary/protocol.js'
import type { ProverContext } from '../context.js'
import { prove as github } from '../github/1/prover.js'
import * as githubTranscript from '../github/1/transcript.js'
import { assembleResult } from '../index.js'
import { prove as x } from '../x/1/prover.js'
import * as xTranscript from '../x/1/transcript.js'

const { prepare, generate, destroy } = vi.hoisted(() => ({
  prepare: vi.fn(),
  generate: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('virtual:ceremony-assets', () => ({ urls: {} }))
vi.mock('../../assets/index.js', async (original) => ({
  ...(await original<typeof import('../../assets/index.js')>()),
  assetUrl: () => 'https://ccdp.test/asset',
}))
vi.mock('../../barretenberg/engine.js', () => ({
  ProofEngine: class {
    constructor({ emit }: ProofEngineOptions) {
      emit?.({ event: 'zk-proof-preparation', phase: 'started', timestamp: 0 })
    }
    prove = generate
    destroy = destroy
  },
}))
vi.mock('../../notary/session.js', () => ({
  Notarization: class {
    constructor(_address: string, signal: AbortSignal) {
      signal.throwIfAborted()
    }
    prepare = prepare
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bearer = 'fixture_BEARER-123'
const userId = '9007199254740993' // Above Number.MAX_SAFE_INTEGER.
const ceremonyId = '6e171568-54e1-4f0d-aeb5-e8859826476a'

for (const platform of ['x', 'github'] as const) {
  it.each([
    'accepted',
    'identity-shape',
    'opening-range',
    'shifted-range',
    'attestation-mismatch',
    'public-input-order',
    'startup-cancel',
  ])(
    `${platform} composes real request selection, openings, witness and delivery: %s [LIBID-PROVER-003] [LIBID-PROVER-004] [LIBID-PROVER-009] [LIBID-PROVER-021] [TEST-PLAT-15A] [TEST-PLAT-15B] [TEST-PLAT-17A] [TEST-PLAT-21]`,
    async (outcome) => {
      if (outcome === 'shifted-range') {
        // Mutate a selector consistently: both the hidden window and its returned
        // range shift by one byte without changing length. The test backend must
        // detect that the resulting attestation commits different bytes.
        const module = platform === 'x' ? xTranscript : githubTranscript
        const select = module.selectIdentity
        vi.spyOn(module, 'selectIdentity').mockImplementation(
          (transcript: Transcript, bearer: string) => {
            const selected = select(transcript, bearer)
            selected.bearerRange.start++
            selected.bearerRange.end++
            selected.ranges.sent[0].end++
            selected.ranges.sent[1].start++
            return selected
          },
        )
      }
      const attestations: NotaryAttestation[] = []
      const transcripts: Transcript[] = []
      const selected: Reveals[] = []
      const commitments: { sent: Uint8Array[]; received: Uint8Array[] }[] = []
      let sessionCount = 0
      // Only the external TLSN runtime and expensive proof engine are replaced.
      // All byte selectors, correlation, witness encoding and client assembly are real.
      prepare.mockImplementation(async (url: string) => {
        const index = sessionCount++
        let transcript: Transcript
        return {
          async send(request: ExactHttpRequest) {
            expect(request.url).toBe(url)
            const target = new URL(url)
            const header = `${request.method} ${target.pathname} HTTP/1.1\r\n${Object.entries(
              request.headers,
            )
              .map(([k, v]) => `${k}: ${decode(v)}\r\n`)
              .join('')}\r\n`
            const body =
              index === 0
                ? `{ "access_token" : "${bearer}", "token_type": "bearer" }`
                : outcome === 'identity-shape'
                  ? `{ "login": "alice", "other": { "id": ${platform === 'x' ? `"${userId}"` : userId}, "username": "alice" } }`
                  : platform === 'x'
                    ? `{ "data": { "username": "alice", "id": "${userId}" } }`
                    : `{ "login" : "alice", "id" : ${userId} , "unused": true }`
            transcript = {
              sent: concat(encode(header), request.body),
              received: encode(
                `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
              ),
            }
            transcripts[index] = transcript
            return transcript
          },
          async reveal(ranges: Reveals) {
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
            const attestedData = encodeAttestation(
              transcript,
              plan,
              commitments[index],
              plan.commit,
              new URL(url).hostname,
            )
            if (outcome === 'attestation-mismatch' && index === 0) attestedData[0] ^= 1
            const correlated = correlateAttestation(
              new URL(url).hostname,
              transcript,
              plan,
              raw,
              attestedData,
            )
            const openings: CommitmentOpening[] = (['sent', 'received'] as const).flatMap(
              (direction) =>
                correlated[direction].map(({ start, end, blinder }) => ({
                  direction,
                  start,
                  end,
                  blinder,
                })),
            )
            if (outcome === 'opening-range' && index === 1) openings[0].start++
            const attestation = { attestedData, signature: new Uint8Array(65).fill(index + 1) }
            attestations[index] = attestation
            return { openings: openings.reverse(), attestation: Promise.resolve(attestation) }
          },
        }
      })
      const hashes = [1, 2].map((byte) =>
        sha256(concat(encode(bearer), new Uint8Array(16).fill(byte))),
      )
      generate.mockImplementation(async (inputs): Promise<RawProof> => {
        expect(commitments[0].received, 'Token commitment must match notarization').toContainEqual(
          Uint8Array.from(inputs.token_commitment),
        )
        expect(commitments[1].sent, 'Identity commitment must match notarization').toEqual([
          Uint8Array.from(inputs.identity_commitment),
        ])
        expect(inputs).toEqual({
          bearer: [...encode(bearer), ...new Uint8Array(128 - bearer.length)],
          bearer_len: String(bearer.length),
          blinder_token: Array(16).fill(1),
          blinder_identity: Array(16).fill(2),
          token_commitment: [...hashes[0]],
          identity_commitment: [...hashes[1]],
        })
        const ordered = outcome === 'public-input-order' ? [...hashes].reverse() : hashes
        return {
          proof: new Uint8Array([1]),
          publicInputs: ordered.flatMap((hash) =>
            [...hash].map((n) => `0x${n.toString(16).padStart(64, '0')}`),
          ),
          runtime: { effectiveThreads: 2, sharedMemory: true },
        }
      })
      const controller = new AbortController()
      const context: ProverContext = {
        ceremonyId,
        signal: controller.signal,
        emit: vi.fn(() => {
          if (outcome === 'startup-cancel') controller.abort(new Error('Closed during startup'))
        }),
        oauthReturn: {
          query: `?code=fixture&state=v1.${ceremonyId}${platform === 'github' ? '&iss=https://github.com/login/oauth' : ''}`,
          fragment: '',
        },
        request: {
          type: 'prove-identity',
          platformId: platform,
          platformCeremonyVersion: 1,
          clientId: 'client',
          clientCredential: 'public-fixture',
          codeVerifier: 'A'.repeat(43), // canonical base64url of 32 zero bytes
          redirectUri: 'https://bridge.test/auth/callback',
          notaryAddress: 'https://notary.test',
        },
      }
      const pending = (platform === 'x' ? x : github)(context)
      if (outcome !== 'accepted') {
        await expect(pending).rejects.toThrow(
          outcome === 'identity-shape'
            ? 'Invalid identity response'
            : outcome === 'shifted-range'
              ? 'Identity commitment must match notarization'
              : outcome === 'startup-cancel'
                ? 'Closed during startup'
                : outcome === 'opening-range'
                  ? 'Bearer opening is not unique'
                  : outcome === 'attestation-mismatch'
                    ? 'attested authority changed'
                    : 'public input mismatch',
        )
      } else {
        const result = await pending
        expect(result?.identity).toEqual({
          platformId: platform,
          oauthClientId: 'client',
          userId,
          userName: 'alice',
        })
        expect(result?.proof).toEqual({
          bearerLinkProof: new Uint8Array([1]),
          tokenAttestation: attestations[0],
          identityAttestation: attestations[1],
        })
        const delivery = structuredClone({ type: 'identity-proof' as const, ...result! })
        expect(assembleResult(platform, 1, delivery, 'client', new Uint8Array(32))).toMatchObject({
          status: 'accepted',
          identity: result!.identity,
        })
        expect(decode(transcripts[0].sent)).toContain('client_id=client&code=fixture')
        expect(decode(transcripts[1].sent)).toContain(`Authorization: Bearer ${bearer}`)
        for (const [index, ranges] of selected.entries()) {
          const disclosed = [
            ...ranges.sent.map((r) => transcripts[index].sent.slice(r.start, r.end)),
            ...ranges.received.map((r) => transcripts[index].received.slice(r.start, r.end)),
          ]
          expect(disclosed.map(decode).join('')).not.toContain(bearer)
        }
      }
      if (outcome === 'startup-cancel') {
        expect(prepare).not.toHaveBeenCalled()
        expect(generate).not.toHaveBeenCalled()
      }
      expect(destroy).toHaveBeenCalledOnce()
    },
  )
}
