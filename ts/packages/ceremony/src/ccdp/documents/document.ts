import type { ConnectionEnd, Message, PopupConnection } from '@libid/popup'
import { EventFeed, failureEvent } from '../../events.js'
import { ccdpError, endError, reportFailure } from '../failure.js'
import { eventView } from './ui.js'

/**
 * One CCDP document's run: its local feed and UI, its connection once accepted, and its one
 * ending. A failure is emitted once, stops the UI, and reaches only an authenticated peer.
 */
export abstract class CeremonyDocument {
  protected readonly feed = new EventFeed()
  protected readonly ui = eventView(this.feed)
  protected abstract readonly connection: PopupConnection<Message> | undefined
  #ended = false

  /** `event` is the operation a failure of this document interrupts. */
  protected constructor(private readonly event: string) {}

  protected get ended(): boolean {
    return this.#ended
  }

  /** End the run and stop its UI; later failures and observations are dropped. */
  protected cleanup(): void {
    this.#ended = true
    this.ui.stop()
  }

  protected fail(error: unknown): void {
    if (this.#ended) return
    const failure = ccdpError(error, this.event)
    this.feed.emit(failureEvent(failure))
    this.cleanup()
    reportFailure(this.connection, failure)
  }

  /** Fail the run as `closedMessage` once its connection ends, unless the end is `expected`. */
  protected failOnEnd(closedMessage: string, expected: (end: ConnectionEnd) => boolean): void {
    void this.connection?.closed.then((end) => {
      if (!expected(end)) this.fail(endError(end, closedMessage))
    })
  }
}
