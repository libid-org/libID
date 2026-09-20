/**
 * TLSNotary ProxyMode + hash-commit web worker. Runs /token then /me:
 *
 *   /token (POST /2/oauth2/token, PKCE): reveals the sent `client_id=<value>`
 *     substring; hash-commits the recv bearer value (the bytes inside the
 *     `"access_token":"..."` quotes).
 *   /me (GET /2/users/me with that bearer): reveals sent[0..bearer_start]
 *     (through `authorization: Bearer `); hash-commits the sent bearer bytes;
 *     reveals (does NOT commit) the recv `"username":"<value>"` snippet so
 *     the contract can parse the handle from `meAttest.recvRevealed`.
 *
 * postMessage output: { type: 'status' | 'done' | 'error', ... }.
 * Typed attestations are fetched by the main thread after the worker
 * returns (see `prover.ts` + `poll-attestation.ts`).
 */

import {
  asciiBytes,
  countSubrange,
  findBearerValueRange,
  findClientIdParamRange,
  findJsonKeyValueRange,
  findObjectEnd,
  findSubrange,
} from './range-finders.js'
import type { ProverStatus } from './prover.js'

/** The worker global, typed to what this file touches. */
const ctx = self as unknown as {
  location: Location
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null
  postMessage: (message: unknown) => void
}

const appOrigin = new URL(ctx.location.href).origin

// ── JsIo bridge ──────────────────────────────────────────────────────────────

interface JsIo {
  read(): Promise<Uint8Array | null>
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}

function createJsIo(ws: WebSocket): JsIo {
  const readQueue: Uint8Array[] = []
  const waitQueue: Array<(data: Uint8Array | null) => void> = []
  let closed = false
  let wsError: Error | null = null

  ws.binaryType = 'arraybuffer'
  ws.onmessage = (ev: MessageEvent) => {
    const data = new Uint8Array(ev.data as ArrayBuffer)
    if (waitQueue.length > 0) waitQueue.shift()!(data)
    else readQueue.push(data)
  }
  ws.onerror = () => {
    wsError = new Error('WebSocket error')
    while (waitQueue.length) waitQueue.shift()!(null)
  }
  ws.onclose = () => {
    closed = true
    while (waitQueue.length) waitQueue.shift()!(null)
  }

  return {
    read() {
      if (wsError) return Promise.reject(wsError)
      if (readQueue.length) return Promise.resolve(readQueue.shift()!)
      if (closed) return Promise.resolve(null)
      return new Promise((resolve) => waitQueue.push(resolve))
    },
    write(data) {
      if (wsError) return Promise.reject(wsError)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
        return Promise.resolve()
      }
      return Promise.reject(new Error('WebSocket not open'))
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      return Promise.resolve()
    },
  }
}

function waitForWsOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket failed to connect'))
  })
}

// ── WASM type ────────────────────────────────────────────────────────────────
// `prover.reveal(reveal, commit)` returns `{ sent: HashOpening[], recv: HashOpening[] }`.

type HashAlg = 'BLAKE3' | 'SHA256' | 'KECCAK256'

interface CommitRange {
  start: number
  end: number
  algorithm: HashAlg
}
interface Reveal {
  sent: Array<{ start: number; end: number }>
  recv: Array<{ start: number; end: number }>
  server_identity: boolean
}
interface Commit {
  sent: CommitRange[]
  recv: CommitRange[]
}

interface HashOpening {
  hash: Uint8Array
  blinder: Uint8Array
}

interface RevealOutput {
  sent: HashOpening[]
  recv: HashOpening[]
}

interface TlsnWasm {
  default: () => Promise<void>
  initialize: (logging: null, threads: number) => Promise<void>
  Prover: new (config: {
    server_name: string
    mode: string
    max_sent_data: number
    max_recv_data: number
    network: string
  }) => {
    set_progress_callback(
      cb: (p: { step: string; progress: number; message: string }) => void,
    ): void
    setup(io: JsIo): Promise<void>
    send_request(
      session: null,
      req: {
        uri: string
        method: 'GET' | 'POST' | 'PUT' | 'DELETE'
        headers: Record<string, number[]>
        body: unknown
      },
    ): Promise<{ status: number; headers: [string, number[]][] }>
    transcript(): { sent: Uint8Array; recv: Uint8Array }
    reveal(opts: Reveal, commit?: Commit): Promise<RevealOutput>
  }
}

// ── HTTP body builder ───────────────────────────────────────────────────────

function buildTokenFormBody(params: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}): string {
  // The profile's five fields in the profile's order, written by the form
  // serializer the verifier holds the body to (`X_TOKEN_FIELDS` in
  // libid-contracts): `encodeURIComponent` is a URI encoder, not that
  // serializer, and spells a space and `!~'()` differently.
  return new URLSearchParams([
    ['grant_type', 'authorization_code'],
    ['client_id', params.clientId],
    ['code', params.code],
    ['redirect_uri', params.redirectUri],
    ['code_verifier', params.codeVerifier],
  ]).toString()
}

// ── Notary session lifecycle ────────────────────────────────────────────────

async function createSession(httpUrl: string): Promise<string> {
  const r = await fetch(`${httpUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxSentData: 4096, maxRecvData: 32768 }),
  })
  if (!r.ok) throw new Error(`Failed to create session: ${r.status}`)
  const { sessionId } = (await r.json()) as { sessionId: string }
  return sessionId
}

// ── WASM init (one-shot per worker lifetime) ────────────────────────────────

let wasmInitialized = false

async function loadWasm(): Promise<TlsnWasm> {
  // The tlsn wasm bundle is staged at the app origin (libid-claim-assets
  // from @libid/claim-full, ex the libid-org/notary release). A dynamic
  // same-origin import keeps the multi-megabyte MPC bundle out of this
  // library's graph.
  const wasmUrl = `${appOrigin}/tlsn_wasm.js`
  const wasm = (await import(/* webpackIgnore: true */ /* @vite-ignore */ wasmUrl)) as TlsnWasm
  if (!wasmInitialized) {
    await wasm.default()
    try {
      await wasm.initialize(null, 1)
    } catch (e) {
      console.warn('[worker] initialize() non-fatal:', e)
    }
    wasmInitialized = true
  }
  return wasm
}

// ── Session runners ─────────────────────────────────────────────────────────
//
// One worker runs /token then /me sequentially, keeping the bearer in
// this JS heap between calls so it never crosses postMessage.

interface WorkerInput {
  notaryUrl: string
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}

interface TokenSessionResult {
  sessionId: string
  commits: Array<{
    direction: 'Received'
    ranges: Array<{ start: number; end: number }>
    hash: Uint8Array
    blinder: Uint8Array
    committedBytes: Uint8Array
  }>
  // bearer string stays in the worker (the /me session reads it here in the
  // same tick). Note: committedBytes above equals the bearer plaintext and
  // DOES cross to the main thread (same-origin) to build the witness — it is
  // never serialized to the notary or backend.
  bearer: string
}

interface MeCommit {
  ranges: Array<{ start: number; end: number }>
  hash: Uint8Array
  blinder: Uint8Array
  committedBytes: Uint8Array
}

interface MeSessionResult {
  sessionId: string
  /** Sent direction commit: bytes [bearer_start..bearer_end] — just the
   *  bearer plaintext (no header wrapper). */
  bearerCommit: MeCommit
  username: string
  /** Immutable platform user-id from /me (`"id":"…"`). "" if absent. */
  userId: string
}

interface HttpRequestSpec {
  uri: string
  method: 'GET' | 'POST'
  headers: Record<string, number[]>
  body: unknown
  progressLabel: string
}

interface SessionResult {
  sessionId: string
  sentPt: Uint8Array
  recvPt: Uint8Array
  revealOutput: RevealOutput
}

// Notarize one TLSN ProxyMode session end-to-end: open WS, MPC pre-comp,
// send_request, reveal+commit. The main thread fetches the typed
// attestation via the on-demand notary endpoint after this returns.
//
// `request` may be a Promise so /me can defer header assembly until
// /token hands over the bearer — letting /me's setup (WS open + MPC
// pre-comp) run concurrently with /token's full session.
async function notarizeSession(opts: {
  label: '/token' | '/me'
  notaryUrl: string
  wasm: TlsnWasm
  request: HttpRequestSpec | Promise<HttpRequestSpec>
  selectReveal: (sentPt: Uint8Array, recvPt: Uint8Array) => { reveal: Reveal; commit: Commit }
}): Promise<SessionResult> {
  const { label, notaryUrl, wasm, request, selectReveal } = opts
  const httpUrl = notaryUrl.replace(/^ws(s?):\/\//, 'http$1://')
  const wsUrl = notaryUrl.replace(/^http(s?):\/\//, 'ws$1://')

  post('notarizing', `Creating ${label} session at ${httpUrl}...`)
  const sessionId = await createSession(httpUrl)

  const ws = new WebSocket(`${wsUrl}/notarize-proxy?sessionId=${encodeURIComponent(sessionId)}`)
  await waitForWsOpen(ws)
  const io = createJsIo(ws)

  const prover = new wasm.Prover({
    server_name: 'api.x.com',
    mode: 'Proxy',
    max_sent_data: 4096,
    max_recv_data: 32768,
    network: 'Bandwidth',
  })
  prover.set_progress_callback((p) =>
    post(
      'notarizing',
      `[WASM ${label}] ${p.step} (${Math.round(p.progress * 100)}%) — ${p.message}`,
    ),
  )

  post('notarizing', `${label} ProxyMode handshake...`)
  await prover.setup(io)

  // Now that setup has run in parallel with the sibling session, block
  // (only /me ever does) until the request spec is ready.
  const resolvedRequest = await request

  post('notarizing', resolvedRequest.progressLabel)
  const response = await prover.send_request(null, {
    uri: resolvedRequest.uri,
    method: resolvedRequest.method,
    headers: resolvedRequest.headers,
    body: resolvedRequest.body,
  })
  if (response.status !== 200) {
    dumpHttpError(label, response, prover)
    throw new Error(`api.x.com ${label} returned HTTP ${response.status}`)
  }

  const transcript = prover.transcript()
  const sentPt: Uint8Array = Uint8Array.from(transcript.sent as unknown as Iterable<number>)
  const recvPt: Uint8Array = Uint8Array.from(transcript.recv as unknown as Iterable<number>)

  const { reveal, commit } = selectReveal(sentPt, recvPt)
  post('notarizing', `Revealing/committing ${label} ranges...`)
  const revealOutput = await prover.reveal(reveal, commit)

  return { sessionId, sentPt, recvPt, revealOutput }
}

// Dump request/response context when send_request returns non-200.
// Logs to console.error; the throw upstream surfaces a short message.
function dumpHttpError(
  label: string,
  response: { status: number; headers: [string, number[]][] },
  prover: { transcript(): { sent: Uint8Array; recv: Uint8Array } },
): void {
  let info = ''
  try {
    const td = new TextDecoder()
    const headerStr = response.headers
      .map(([k, v]) => `${k}: ${td.decode(Uint8Array.from(v as number[]))}`)
      .join(' | ')
    const recv = Uint8Array.from(prover.transcript().recv as unknown as Iterable<number>)
    const recvText = td.decode(recv)
    const sep = recvText.indexOf('\r\n\r\n')
    const body = (sep >= 0 ? recvText.slice(sep + 4) : recvText).slice(0, 500)
    const hexDump = Array.from(recv.slice(0, 256))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const sent = Uint8Array.from(prover.transcript().sent as unknown as Iterable<number>)
    const sentText = td.decode(sent).slice(0, 1000)
    info = `headers=[${headerStr}] body=${JSON.stringify(body)} recv_len=${recv.length} hex=${hexDump} SENT=${JSON.stringify(sentText)} sent_len=${sent.length}`
  } catch (e) {
    info = `(extract failed: ${(e as Error).message})`
  }
  console.error(`[worker] ${label} HTTP ${response.status} info:`, info)
}

async function runTokenSession(
  input: {
    notaryUrl: string
    code: string
    codeVerifier: string
    redirectUri: string
    clientId: string
    /// Fired as soon as the bearer is parsed from the recv transcript —
    /// BEFORE prove() finalization — so /me can build its Authorization
    /// header without waiting for the rest of /token to complete.
    onBearer?: (bearer: string) => void
  },
  wasm: TlsnWasm,
): Promise<TokenSessionResult> {
  const enc = (s: string) => Array.from(new TextEncoder().encode(s))
  const formBody = buildTokenFormBody({
    code: input.code,
    codeVerifier: input.codeVerifier,
    redirectUri: input.redirectUri,
    clientId: input.clientId,
  })
  // tlsn-wasm `Body = JsonValue` (untagged enum). Passing the form string
  // directly deserializes to `Body::Json(Value::String(s))`; sdk-core then
  // strips the JSON quotes and writes the raw bytes. Form parsing is driven
  // by the `Content-Type` header below. Note: do NOT wrap in `{ Json: ... }`
  // — that would deserialize to `Value::Object`, falling back to `to_vec`
  // and sending literal `{"Json":"..."}` bytes (X then 400s with "Missing
  // required parameter [grant_type]").
  let accessTokenLoc: ReturnType<typeof findJsonKeyValueRange> = null
  let clientIdLoc: ReturnType<typeof findClientIdParamRange> = null

  const { sessionId, recvPt, revealOutput } = await notarizeSession({
    label: '/token',
    notaryUrl: input.notaryUrl,
    wasm,
    request: {
      uri: '/2/oauth2/token',
      method: 'POST',
      headers: {
        Host: enc('api.x.com'),
        'Content-Type': enc('application/x-www-form-urlencoded'),
        Accept: enc('application/json'),
        Connection: enc('close'),
      },
      body: formBody,
      progressLabel: 'POST /2/oauth2/token...',
    },
    selectReveal: (sentPt, recvPt) => {
      clientIdLoc = findClientIdParamRange(sentPt)
      if (!clientIdLoc) throw new Error('client_id parameter not found in sent transcript')
      accessTokenLoc = findJsonKeyValueRange(recvPt, asciiBytes('"access_token":"'))
      if (!accessTokenLoc) throw new Error('access_token field not found in recv transcript')
      if (input.onBearer) {
        input.onBearer(new TextDecoder().decode(accessTokenLoc.value))
      }
      return {
        reveal: {
          sent: [clientIdLoc.range],
          recv: [],
          server_identity: true,
        },
        // Commit ONLY the bearer-value bytes (between the quotes), so
        // SHA256(bearer || blinder_token) matches the circuit's
        // bearer-only hash.
        commit: {
          sent: [],
          recv: [{ ...accessTokenLoc.valueRange, algorithm: 'SHA256' }],
        },
      }
    },
  })

  if (revealOutput.recv.length !== 1) {
    throw new Error(`/token expected 1 recv opening, got ${revealOutput.recv.length}`)
  }
  const bearerOpening = revealOutput.recv[0]
  // Bearer-value bytes only (matches the committed range above).
  const committedBytes = recvPt.slice(
    accessTokenLoc!.valueRange.start,
    accessTokenLoc!.valueRange.end,
  )

  return {
    sessionId,
    commits: [
      {
        direction: 'Received',
        ranges: [accessTokenLoc!.valueRange],
        hash: bearerOpening.hash,
        blinder: bearerOpening.blinder,
        committedBytes,
      },
    ],
    // Bearer captured here; the caller in this worker hands it to the /me
    // session. It NEVER crosses the postMessage boundary.
    bearer: new TextDecoder().decode(accessTokenLoc!.value),
  }
}

async function runMeSession(
  input: { notaryUrl: string; bearerPromise: Promise<string> },
  wasm: TlsnWasm,
): Promise<MeSessionResult> {
  const enc = (s: string) => Array.from(new TextEncoder().encode(s))
  let bearerLoc: ReturnType<typeof findBearerValueRange> = null
  let usernameLoc: ReturnType<typeof findJsonKeyValueRange> = null
  let idLoc: ReturnType<typeof findJsonKeyValueRange> = null

  // Defer header assembly: notarizeSession runs setup + WS handshake
  // immediately, awaits this promise just before send_request.
  const requestPromise = input.bearerPromise.then((bearer) => ({
    uri: '/2/users/me',
    method: 'GET' as const,
    headers: {
      // `Authorization` MUST be the FIRST header — hyper preserves
      // header-object insertion order on wire. The verifier contract
      // requires the revealed prefix to end with `authorization: Bearer `
      // immediately before the bearer commit range.
      Authorization: enc(`Bearer ${bearer}`),
      Accept: enc('application/json'),
      Host: enc('api.x.com'),
      Connection: enc('close'),
    },
    body: null,
    progressLabel: 'GET /2/users/me...',
  }))

  const { sessionId, sentPt, revealOutput } = await notarizeSession({
    label: '/me',
    notaryUrl: input.notaryUrl,
    wasm,
    request: requestPromise,
    selectReveal: (sentPt, recvPt) => {
      bearerLoc = findBearerValueRange(sentPt)
      if (!bearerLoc) throw new Error('Authorization header not found in sent transcript')
      // Anchor BOTH username and id to the X `/me` `data` object so we never
      // pick a field from an unrelated part of the transcript (headers,
      // nested objects). `dataMarker.end` is just past the opening `{`;
      // bound the object at its matching close so uniqueness counts stay
      // inside `data`.
      const dataMarker = findSubrange(recvPt, asciiBytes('"data":{'))
      if (!dataMarker) throw new Error('/me data object ("data":{) not found in recv transcript')
      const dataObjEnd = findObjectEnd(recvPt, dataMarker.end - 1)
      if (dataObjEnd === null) throw new Error('/me data object is unterminated in recv transcript')
      const dataObj = recvPt.slice(dataMarker.end, dataObjEnd)

      const usernameNeedle = asciiBytes('"username":"')
      usernameLoc = findJsonKeyValueRange(recvPt, usernameNeedle, dataMarker.end)
      if (!usernameLoc || usernameLoc.range.end > dataObjEnd)
        throw new Error('username field not found in /me data object')
      const usernameCount = countSubrange(dataObj, usernameNeedle)
      if (usernameCount !== 1)
        throw new Error(
          `/me expected exactly one "username":" in the data object, got ${usernameCount}`,
        )
      // Also reveal the immutable numeric id (`"id":"…"`) from the same /me
      // response so the contract can key on (platform, id). Revealed (not
      // committed) — the notary attests it in recv_revealed and the
      // contract byte-matches it out of meAttest.recvRevealed.
      //
      // Assert there is EXACTLY ONE `"id":"` inside the data object —
      // mirrors the contract's uniqueness invariant so the browser fails
      // closed.
      const idNeedle = asciiBytes('"id":"')
      idLoc = findJsonKeyValueRange(recvPt, idNeedle, dataMarker.end)
      if (!idLoc || idLoc.range.end > dataObjEnd)
        throw new Error('id field not found in /me data object')
      const idCount = countSubrange(dataObj, idNeedle)
      if (idCount !== 1)
        throw new Error(`/me expected exactly one "id":" in the data object, got ${idCount}`)
      // SENT: two revealed ranges —
      //   [0..bearer_start]  request line + headers ending in
      //                       `authorization: Bearer ` (start adjacency).
      //   [bearer_end..bearer_end+2]  exactly the 2 bytes after bearer.
      //                       Contract requires them == `\r\n` (H1 end
      //                       anchor → canonicalizes bearer_len).
      // Hash-commit ONLY the bearer bytes in between.
      // RECV: reveal the username JSON snippet for the on-chain handle
      // byte-match.
      const revealedPrefix = { start: 0, end: bearerLoc.range.start }
      const revealedSuffix = {
        start: bearerLoc.range.end,
        end: bearerLoc.range.end + 2,
      }
      // RECV ranges must be sorted by start (TLSN requires ordered,
      // non-overlapping); id and username order varies by response shape.
      const recvRanges = [usernameLoc.range, idLoc.range].sort((a, b) => a.start - b.start)
      // Fail closed if the two snippets overlap (TLSN rejects overlapping
      // reveals; an overlap would also imply a malformed/ambiguous
      // response).
      for (let i = 1; i < recvRanges.length; i++) {
        if (recvRanges[i - 1].end > recvRanges[i].start)
          throw new Error('/me recv reveal ranges overlap')
      }
      return {
        reveal: {
          sent: [revealedPrefix, revealedSuffix],
          recv: recvRanges,
          server_identity: true,
        },
        commit: {
          sent: [{ ...bearerLoc.range, algorithm: 'SHA256' }],
          recv: [],
        },
      }
    },
  })

  if (revealOutput.sent.length !== 1) {
    throw new Error(`/me expected 1 sent opening (bearer commit), got ${revealOutput.sent.length}`)
  }
  const bearerOpening = revealOutput.sent[0]
  const bearerBytes = sentPt.slice(bearerLoc!.range.start, bearerLoc!.range.end)

  return {
    sessionId,
    bearerCommit: {
      ranges: [bearerLoc!.range],
      hash: bearerOpening.hash,
      blinder: bearerOpening.blinder,
      committedBytes: bearerBytes,
    },
    // Username is REVEALED (not committed) on the recv side; the notary
    // signs over `recv_revealed` directly and the contract parses the
    // handle out of `meAttest.recvRevealed`.
    username: new TextDecoder().decode(usernameLoc!.value),
    userId: new TextDecoder().decode(idLoc!.value),
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

// /token and /me run concurrently within one worker: /me's setup (WS
// handshake + MPC pre-comp) overlaps with /token. /me blocks just
// before send_request until /token publishes the bearer via the
// `onBearer` callback. Saves one TLS handshake RTT + most of one MPC
// pre-comp from the critical path. Two `Prover` instances coexist in
// one WASM heap — cheap, unlike the rejected dual-Worker design.
ctx.onmessage = async ({ data }: MessageEvent<WorkerInput>) => {
  try {
    post('notarizing', 'Loading TLSNotary WASM...')
    const wasm = await loadWasm()

    let bearerResolve!: (bearer: string) => void
    const bearerPromise = new Promise<string>((resolve) => {
      bearerResolve = resolve
    })

    const [tokenResult, meResult] = await Promise.all([
      runTokenSession(
        {
          notaryUrl: data.notaryUrl,
          code: data.code,
          codeVerifier: data.codeVerifier,
          redirectUri: data.redirectUri,
          clientId: data.clientId,
          onBearer: bearerResolve,
        },
        wasm,
      ),
      runMeSession({ notaryUrl: data.notaryUrl, bearerPromise }, wasm),
    ])

    ctx.postMessage({
      type: 'done',
      tokenSession: {
        sessionId: tokenResult.sessionId,
        commits: tokenResult.commits,
      },
      meSession: {
        sessionId: meResult.sessionId,
        bearerCommit: meResult.bearerCommit,
        username: meResult.username,
        userId: meResult.userId,
      },
    })
  } catch (e) {
    ctx.postMessage({
      type: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

const timingStart = performance.now()
let timingLast = timingStart
function post(status: ProverStatus, msg: string) {
  const now = performance.now()
  const total = ((now - timingStart) / 1000).toFixed(2)
  const step = ((now - timingLast) / 1000).toFixed(2)
  timingLast = now
  const stamped = `[+${step}s | t=${total}s] ${msg}`
  console.log('[worker]', stamped)
  ctx.postMessage({ type: 'status', status, msg: stamped })
}
