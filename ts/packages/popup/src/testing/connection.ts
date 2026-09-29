import type { ConnectionEnd, PopupConnection } from '../connection.js'
import { PopupError } from '../diagnostics.js'
import type { Message, MessageType } from '../message.js'
import { POPUP_ORIGIN } from './fakes.js'

/** A connection whose peer the test drives: it records sends and navigations, delivers messages, and ends. */
export interface FakeConnection<Out extends Message = Message, In extends Message = Out>
  extends PopupConnection<Out, In> {
  peerOrigin: string | null
  /** Messages sent before the connection ended; a later send throws `send-unavailable`. */
  readonly sent: Out[]
  readonly navigations: { url: string; fragment?: string; away: boolean }[]
  ended: boolean
  /** Deliver `message` from the peer to its registered handler; ignored once ended. */
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
 */
export function fakeConnection<Out extends Message = Message, In extends Message = Out>({
  peerOrigin = POPUP_ORIGIN,
  ready = 'resolved',
}: {
  peerOrigin?: string | null
  ready?: 'resolved' | 'pending'
} = {}): FakeConnection<Out, In> {
  let settleReady!: (error?: unknown) => void
  let endConnection!: (outcome: ConnectionEnd) => void
  const readiness = new Promise<void>((resolve, reject) => {
    settleReady = (error) => (error === undefined ? resolve() : reject(error))
  })
  if (ready === 'resolved') settleReady()
  const handlers = new Map<string, (value: unknown) => void>()
  const connection: FakeConnection<Out, In> = {
    peerOrigin,
    ready: readiness,
    closed: new Promise<ConnectionEnd>((resolve) => {
      endConnection = resolve
    }),
    sent: [],
    navigations: [],
    ended: false,
    send: (message) => {
      // As the real connection: an ended connection refuses to send.
      if (connection.ended) throw new PopupError('send-unavailable')
      connection.sent.push(message)
    },
    on<N extends In>(type: MessageType<N>, handler: (message: N) => void) {
      if (handlers.has(type.type)) throw new TypeError(`"${type.type}" is already registered`)
      const deliver = (value: unknown) => handler(type.decode(value))
      handlers.set(type.type, deliver)
      return () => {
        if (handlers.get(type.type) === deliver) handlers.delete(type.type)
      }
    },
    navigate: async (url, fragment) => {
      connection.navigations.push({ url, fragment: fragment?.toString(), away: false })
    },
    navigateAway: async (url, fragment) => {
      if (connection.ended) throw new Error('Connection closed')
      connection.navigations.push({ url, fragment: fragment?.toString(), away: true })
    },
    close: async () => connection.end(),
    receive: (message) => {
      if (!connection.ended) handlers.get(message.type)?.(message)
    },
    end: (outcome = { outcome: 'closed' }) => {
      if (connection.ended) return
      connection.ended = true
      endConnection(outcome)
    },
    settle: (error) => settleReady(error),
  }
  return connection
}
