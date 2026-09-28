/**
 * X Identity ZK Prover — TLSNotary hash-commit + token-only Noir proof.
 *
 *   1. /token TLSN session (api.x.com): POST /2/oauth2/token (PKCE). Reveal
 *      the `client_id=<value>` substring; hash-commit the bearer-value
 *      bytes of `"access_token":"<bearer>"`.
 *   2. /me TLSN session: GET /2/users/me with bearer. Reveal the request
 *      prefix `[0..bearer_start]` and the `"username":"<value>"` recv
 *      snippet; hash-commit only the sent bearer bytes.
 *   3. Build a Noir witness for the dual-blinder token circuit (proves one
 *      private bearer hashes to BOTH attestation commits).
 *   4. UltraHonk-prove via bb.js.
 *   5. Return proof + `TokenAttestation`/`MeAttestation`.
 */

import { type RawProof, WorkerProver } from '../prover/index.js'
import type { MeAttestationWire, TokenAttestationWire } from './poll-attestation.js'
import { buildXTokenWitness, witnessToNoirInputMap } from './witness-token.js'

/** Status events actually emitted by `runXProver`. Kept tight to what the
 *  orchestrator broadcasts so a progress UI doesn't render dead phases. */
export type ProverStatus = 'idle' | 'notarizing' | 'proving-token' | 'done' | 'error'

/** Single hash commit emitted by the worker (paired with its blinder + the
 *  committed plaintext bytes for use as Noir witness). */
interface WorkerHashCommit {
  direction: 'Sent' | 'Received'
  ranges: Array<{ start: number; end: number }>
  hash: Uint8Array
  blinder: Uint8Array
  committedBytes: Uint8Array
}

/** Result of `runXProver`: token-only ZK proof + two attestations. */
export interface XProofResult {
  proof: `0x${string}`
  publicInputs: `0x${string}`[]
  tokenAttest: TokenAttestationWire
  meAttest: MeAttestationWire
  /** Handle extracted from /me (`username` field), needed by callers for UI. */
  handle: string
  /** Platform name (`api.x.com`). */
  platform: string
}

// ── Byte helpers ────────────────────────────────────────────────────────────

export function bytesToHex(b: Uint8Array | number[]): `0x${string}` {
  return `0x${Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`
}

// ── Worker driver (single invocation runs BOTH /token + /me sessions) ──────
// Bearer plaintext never crosses postMessage — the worker captures it between
// the two TLSN sessions and emits only commits + sessionIds.

interface DualSessionParams {
  notaryUrl: string
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}

interface DualWorkerOutput {
  tokenSession: {
    sessionId: string
    commits: WorkerHashCommit[]
  }
  meSession: {
    sessionId: string
    bearerCommit: WorkerHashCommit
    username: string
    userId: string
  }
}

function runDualSessionWorker(
  params: DualSessionParams,
  onStatus: (s: ProverStatus, msg?: string) => void,
): Promise<DualWorkerOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prover.worker.js', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data
      if (data.type === 'status') {
        onStatus('notarizing', data.msg)
      } else if (data.type === 'done') {
        worker.terminate()
        resolve({
          tokenSession: data.tokenSession as DualWorkerOutput['tokenSession'],
          meSession: data.meSession as DualWorkerOutput['meSession'],
        })
      } else if (data.type === 'error') {
        worker.terminate()
        reject(new Error(data.error))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Worker error'))
    }
    worker.postMessage({
      notaryUrl: params.notaryUrl,
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirectUri: params.redirectUri,
      clientId: params.clientId,
    })
  })
}

// Format the worker's raw proof into the on-chain XProof shape: hex proof +
// 32-byte zero-padded public inputs.
function formatXProof(raw: RawProof): {
  proof: `0x${string}`
  publicInputs: `0x${string}`[]
} {
  return {
    proof: bytesToHex(raw.proof),
    publicInputs: raw.publicInputs.map(
      (pi) => `0x${BigInt(pi).toString(16).padStart(64, '0')}` as `0x${string}`,
    ),
  }
}

// ── Main orchestrator ──────────────────────────────────────────────────────

export interface XProverOptions {
  notaryUrl: string
  /** OAuth2 PKCE: code returned by X to the callback. */
  code: string
  /** OAuth2 PKCE: code_verifier (browser-generated). */
  codeVerifier: string
  /** OAuth2 redirect_uri exactly as registered + sent to X. */
  redirectUri: string
  /** X OAuth client_id (must match the one the verifier contract commits). */
  clientId: string
  /** 20-byte ETH address of the session key (rides in the attestation). */
  sessionAddr: `0x${string}`
  /** 20-byte wallet address to bind the proof to (msg.sender on chain). */
  walletAddress: `0x${string}`
  /** Same-origin URL of the compiled token circuit JSON. Defaults to
   *  `${origin}/circuits/x_token.json` (libid-claim-assets stages it
   *  there; see libid-org/libID-circuits releases). */
  circuitUrl?: string
  onStatus?: (s: ProverStatus, msg?: string) => void
  /** Aborts proving when the user cancels (before submit). */
  signal?: AbortSignal
  /** Last pre-proof check, called once /me reveals the selected account. */
  checkIdentity: (identity: { handle: string; userId: string }) => Promise<void>
}

function addrHexToBytes(hex: `0x${string}`): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length !== 40) throw new Error(`expected 20-byte address, got ${h.length / 2}`)
  const out = new Uint8Array(20)
  for (let i = 0; i < 20; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** X identity ZK orchestrator: sequential /token + /me TLSN ProxyMode
 *  sessions feeding ONE token-only UltraHonk proof. On-chain: one
 *  verifier call. */
export async function runXProver(opts: XProverOptions): Promise<XProofResult> {
  const {
    notaryUrl,
    code,
    codeVerifier,
    redirectUri,
    clientId,
    sessionAddr,
    walletAddress,
    onStatus = () => {},
    signal,
    checkIdentity,
  } = opts
  const sessionAddrBytes = addrHexToBytes(sessionAddr)
  const walletAddressBytes = addrHexToBytes(walletAddress)

  const t0 = performance.now()
  const stamp = (start: number) => `(${((performance.now() - start) / 1000).toFixed(2)}s)`

  // ── Phase 1: TLSN sessions + bb.js preload in parallel ──
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const xCircuit = opts.circuitUrl ?? `${origin}/circuits/x_token.json`

  // Spawn the worker prover up front: it boots noir + bb.js in a worker
  // (off the main thread) while the TLSN sessions run, so proving neither
  // freezes this document nor waits on bb.js boot afterward.
  const prover = new WorkerProver(xCircuit)

  // One owner for the worker: the outer finally destroys it on EVERY exit —
  // success, a thrown abort before proving, or a TLSN/prove/attestation
  // error — so an aborted or failed run can't leak it.
  try {
    const tTlsn = performance.now()
    onStatus('notarizing', 'Notarizing /token + /me + preloading prover...')
    const { tokenSession, meSession } = await runDualSessionWorker(
      { notaryUrl, code, codeVerifier, redirectUri, clientId },
      onStatus,
    )
    console.log('[libid-timing] dual TLSN sessions + preload', stamp(tTlsn))
    await checkIdentity({
      handle: meSession.username,
      userId: meSession.userId,
    })

    // ── Phase 2: build dual-blinder witness + single small UltraHonk proof ──
    // Each TLSN session derives its OWN blinder. The circuit binds them by
    // proving the same private bearer hashes to both attestation commits.
    const bearerBytes = meSession.bearerCommit.committedBytes
    const blinderMe = meSession.bearerCommit.blinder
    const blinderToken = tokenSession.commits[0].blinder
    const tokenWitness = buildXTokenWitness({
      bearer: bearerBytes,
      blinderToken,
      blinderMe,
      walletAddress: walletAddressBytes,
      sessionAddr: sessionAddrBytes,
    })
    const witnessInputs = witnessToNoirInputMap(tokenWitness)

    const tProof = performance.now()
    signal?.throwIfAborted() // honor a cancel from the notarize phase
    onStatus('proving-token', 'Generating UltraHonk proof...')
    const tokenProof = formatXProof(await prover.prove(witnessInputs, signal))
    console.log('[libid-timing] token-only UltraHonk proof', stamp(tProof))

    // ── Phase 3: fetch notary attestations (token + me) ──
    // Notary URL becomes httpUrl for HTTP (notaryUrl may be ws:// / http://).
    const httpUrl = notaryUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    onStatus('notarizing', 'Fetching token-shape + me-shape attestations...')
    const { pollTokenAttestation, pollMeAttestation } = await import('./poll-attestation.js')
    const [tokenAttest, meAttest] = await Promise.all([
      pollTokenAttestation(httpUrl, tokenSession.sessionId),
      pollMeAttestation(httpUrl, meSession.sessionId, {
        handle: meSession.username,
        userId: meSession.userId,
        sessionAddr,
      }),
    ])
    console.log('[libid-timing] TOTAL runXProver', stamp(t0))
    onStatus('done', 'Token-only proof + attestations ready')

    return {
      proof: tokenProof.proof,
      publicInputs: tokenProof.publicInputs,
      tokenAttest,
      meAttest,
      handle: meSession.username,
      platform: 'api.x.com',
    }
  } finally {
    prover.destroy()
  }
}
