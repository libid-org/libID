import type { ConnectionEnd, PopupConnection } from '../connection.js'
import { PopupError } from '../diagnostics.js'
import type { Message, MessageType } from '../message.js'
import { ID, POPUP_ORIGIN } from './fakes.js'

/** A connection whose peer the test drives: it records sends and navigations, delivers messages, and ends. */
export interface FakeConnection<Out extends Message = Message, In extends Message = Out>
  extends PopupConnection<Out, In> {
  peerOrigin: string | null
  /** Messages sent before the connection ended; a later send throws `connection-closed`. */
  readonly sent: Out[]
  readonly navigations: { url: string; fragment?: string; away: boolean }[]
  ended: boolean
  /**
   * Deliver `message` from the peer to its registered handler; ignored once ended. As in the
   * real connection, a type without a handler or a value its decoder rejects ends the connection
   * failed with `decode-rejected`.
   */
  receive(message: In | (Message & Record<string, unknown>)): void
  /** End as the transport would. `close()` ends with `{ outcome: 'closed' }`. */
  end(outcome?: ConnectionEnd): void
  /** Settle a `ready: 'pending'` connection, rejecting it when `error` is given. */
  settle(error?: unknown): void
}

/**
 * Stand-in for a connection-layer client of PopupConnection. Methods are own properties, so tests
 * can wrap them with their framework's spies. Registration mirrors the real contract: one handler
 * per message type, decoded before delivery.
 *
 * Ending failed rejects a still pending `ready` with the code. `endpoint` picks which side's
 * contract a closed end follows: the application's rejects a pending `ready` with
 * `connection-closed`; a popup document's (the default) leaves it pending for its successor.
 */
export function fakeConnection<Out extends Message = Message, In extends Message = Out>({
  connectionId = ID,
  peerOrigin = POPUP_ORIGIN,
  ready = 'resolved',
  endpoint = 'popup',
}: {
  connectionId?: string
  peerOrigin?: string | null
  ready?: 'resolved' | 'pending'
  endpoint?: 'application' | 'popup'
} = {}): FakeConnection<Out, In> {
  let settleReady!: (error?: unknown) => void
  let endConnection!: (outcome: ConnectionEnd) => void
  const readiness = new Promise<void>((resolve, reject) => {
    settleReady = (error) => (error === undefined ? resolve() : reject(error))
  })
  // A consumer that only awaits `closed` must not see an unhandled rejection.
  readiness.catch(() => {})
  if (ready === 'resolved') settleReady()
  const handlers = new Map<string, (value: unknown) => void>()
  const closedError = () => new PopupError('connection-closed')
  const connection: FakeConnection<Out, In> = {
    connectionId,
    peerOrigin,
    ready: readiness,
    closed: new Promise<ConnectionEnd>((resolve) => {
      endConnection = resolve
    }),
    sent: [],
    navigations: [],
    ended: false,
    send: (message) => {
      if (connection.ended) throw closedError()
      connection.sent.push(message)
    },
    on<N extends In>(type: MessageType<N>, handler: (message: N) => void) {
      if (handlers.has(type.type)) throw new TypeError(`"${type.type}" is already registered`)
      const deliver = (value: unknown) => {
        let message: N
        try {
          message = type.decode(value)
        } catch {
          connection.end({ outcome: 'failed', code: 'decode-rejected' })
          return
        }
        handler(message)
      }
      handlers.set(type.type, deliver)
      return () => {
        if (handlers.get(type.type) === deliver) handlers.delete(type.type)
      }
    },
    navigate: async (url, fragment) => {
      if (connection.ended) throw closedError()
      connection.navigations.push({ url, fragment: fragment?.toString(), away: false })
    },
    navigateAway: async (url, fragment) => {
      if (connection.ended) throw closedError()
      connection.navigations.push({ url, fragment: fragment?.toString(), away: true })
    },
    close: async () => connection.end(),
    receive: (message) => {
      if (connection.ended) return
      const deliver = handlers.get(message.type)
      if (deliver) deliver(message)
      else connection.end({ outcome: 'failed', code: 'decode-rejected' })
    },
    end: (outcome = { outcome: 'closed' }) => {
      if (connection.ended) return
      connection.ended = true
      if (outcome.outcome === 'failed') settleReady(new PopupError(outcome.code))
      else if (endpoint === 'application') settleReady(closedError())
      endConnection(outcome)
    },
    settle: (error) => settleReady(error),
  }
  return connection
}
