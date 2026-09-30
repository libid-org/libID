// The TLSNotary SDK surface the session worker uses. The e2e fixture stands in for it.
import type { ByteRange } from './protocol.js'

export interface CommitRange extends ByteRange {
  algorithm: 'SHA256'
}

/** The SDK may hand bytes back as plain arrays; the worker copies them into `Uint8Array`s. */
export interface TlsnOpening {
  hash: ArrayLike<number>
  blinder: ArrayLike<number>
}

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
    transcript(): { sent: ArrayLike<number>; recv: ArrayLike<number> }
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
    ): Promise<{ sent: TlsnOpening[]; recv: TlsnOpening[] }>
    finish(): Promise<void>
    free(): void
  }
}

export type TlsnProver = InstanceType<TlsnModule['Prover']>
