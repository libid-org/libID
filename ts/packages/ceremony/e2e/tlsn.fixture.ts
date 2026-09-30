// Test-only SDK/peer replacement. Signatures are synthetic; no TLS or notary
// cryptography runs here. The real session worker validates/correlates these bytes.
import { concat, encodeAttestation, opening } from '../src/notary/fixtures/attestation.js'
import type { NotarizationPlan } from '../src/notary/notarize.js'
import type { ByteRange, Transcript } from '../src/notary/protocol.js'
import type { CommitRange, NotaryHttpRequest, TlsnModule } from '../src/notary/tlsn.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const tokenResponse = '{ "access_token" : "fixture_BEARER-123", "token_type": "bearer" }'

class FixtureSocket extends EventTarget {
  static OPEN = 1
  static CONNECTING = 0
  readyState = FixtureSocket.OPEN
  binaryType = 'arraybuffer'

  send(data: Uint8Array) {
    queueMicrotask(() => {
      // A fragmented final frame followed by EOF exercises the real channel reader.
      for (const chunk of [data.slice(0, 7), data.slice(7)])
        this.dispatchEvent(new MessageEvent('message', { data: chunk.buffer }))
      this.close()
    })
  }

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

export default async function init() {
  Object.assign(globalThis, { WebSocket: FixtureSocket })
}

export async function initialize() {}

export class Prover {
  private io!: { write(data: Uint8Array): Promise<void> }
  private bytes!: Transcript
  private attestedData!: Uint8Array

  constructor(private config: { server_name: string }) {}

  async setup(io: { write(data: Uint8Array): Promise<void> }) {
    this.io = io
  }

  async send_request(_: null, request: NotaryHttpRequest) {
    const responses: Record<string, string> = {
      'api.x.com/2/oauth2/token': tokenResponse,
      'api.x.com/2/users/me': '{ "data" : { "id" : "9007199254740993", "username" : "alice" } }',
      'github.com/login/oauth/access_token': tokenResponse,
      'api.github.com/user': '{ "id" : 9007199254740993 , "login" : "alice" }',
    }
    const body = responses[this.config.server_name + request.uri]
    if (!body) throw new Error('Unexpected fixture request')
    this.bytes = {
      sent: encoder.encode(
        `${request.method} ${request.uri} HTTP/1.1\r\n` +
          Object.entries(request.headers)
            .map(([key, value]) => `${key}: ${decoder.decode(Uint8Array.from(value))}\r\n`)
            .join('') +
          `\r\n${request.body ?? ''}`,
      ),
      received: encoder.encode(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${encoder.encode(body).length}\r\n\r\n${body}`,
      ),
    }
    return { status: 200, headers: [] }
  }

  transcript() {
    return { sent: this.bytes.sent, recv: this.bytes.received }
  }

  async reveal(
    reveal: { sent: ByteRange[]; recv: ByteRange[]; server_identity: true },
    commit: { sent: CommitRange[]; recv: CommitRange[] },
  ) {
    const plan: NotarizationPlan = {
      reveal: { sent: reveal.sent, received: reveal.recv },
      commit: { sent: commit.sent, received: commit.recv },
    }
    // Distinct blinders for the token and identity sessions.
    const byte = this.bytes.sent[0] === 80 ? 1 : 2
    const sent = commit.sent.map((range) => opening(this.bytes.sent, range, byte))
    const recv = commit.recv.map((range) => opening(this.bytes.received, range, byte))
    this.attestedData = encodeAttestation(
      this.bytes,
      plan,
      { sent: sent.map((o) => o.hash), received: recv.map((o) => o.hash) },
      plan.commit,
      this.config.server_name,
    )
    return { sent, recv }
  }

  async finish() {
    if (Reflect.get(globalThis, '__corruptAttestation')) this.attestedData[0] ^= 1
    const payload = encoder.encode(
      JSON.stringify({
        attested_data: Array.from(this.attestedData),
        notary_signature: Array(65).fill(1),
      }),
    )
    const length = new Uint8Array(4)
    new DataView(length.buffer).setUint32(0, payload.length)
    await this.io.write(concat(length, payload))
  }

  free() {}
}

// The session worker imports this module as the SDK.
void ({ default: init, initialize, Prover } satisfies TlsnModule)
