// The TLSNotary SDK surface the session worker uses. The e2e fixture stands in for it.
import type { CommitRange, HashOpening } from './notarize.js'
import type { ByteRange } from './protocol.js'

export interface Io {
  read(): Promise<Uint8Array | null>
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface NotaryHttpRequest {
  uri: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, number[]>
  body: unknown
}

export interface TlsnModule {
  default(options: { module_or_path: string }): Promise<void>
  initialize(logging: null, threads: number): Promise<void>
  Prover: new (config: {
    server_name: string
    mode: 'Proxy'
    max_sent_data: number
    max_recv_data: number
    network: 'Bandwidth'
  }) => {
    setup(io: Io): Promise<void>
    send_request(session: null, request: NotaryHttpRequest): Promise<unknown>
    transcript(): { sent: Uint8Array; recv: Uint8Array }
    reveal(
      reveal: {
        sent: readonly ByteRange[]
        recv: readonly ByteRange[]
        server_identity: true
      },
      commit: {
        sent: readonly CommitRange[]
        recv: readonly CommitRange[]
      },
    ): Promise<{ sent: HashOpening[]; recv: HashOpening[] }>
    finish(): Promise<void>
    free(): void
  }
}

export type TlsnProver = InstanceType<TlsnModule['Prover']>
