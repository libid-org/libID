import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { profileKey, route } from '../../assets/keys.js'
import { claimRootWorker, remainingDownloads } from '../../assets/registration.js'
import { EventFeed, failureEvent, isCoreEvent, now, type OperationEvent } from '../../events.js'
import { ceremonyFor } from '../../platforms/index.js'
import { acceptReturn } from '../../platforms/oauthReturn.js'
import { type ProverResult, proverFor } from '../../platforms/provers.js'
import { ccdpError, endError, reportFailure } from '../failure.js'
import { EventMessage, IdentityProof, ProveIdentity } from '../index.js'
import { readProver } from '../navigation.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { eventView, view } from './ui.js'

type ProverState =
  | { phase: 'connecting' | 'ready'; input: ReturnType<typeof readProver> }
  | { phase: 'proving' | 'ended' }

/** Accept the private callback fragment, run the selected prover and deliver one terminal result. */
export async function startProver(fragment: string): Promise<void> {
  try {
    const input = readProver(fragment)
    // Popup reports the isolation hop just before it releases this page to the fallback.
    const hop = { leaving: false }
    const connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: [input.applicationOrigin],
      isolationFallbackUrl: location.origin + route('prover/fallback'),
      onDiagnostic: ({ code }) => {
        if (code === 'isolation-fallback') hop.leaving = true
      },
    })
    await new ProverDocument(connection, input, hop).start()
  } catch (error) {
    const failure = ccdpError(error, 'prover')
    view(messages.returnToApplication(failure.message))
    reportFailure(undefined, failure)
  }
}

/** Owns readiness, the one-shot OAuth capture and its admission, local UI/feed, and proof delivery. */
class ProverDocument {
  private readonly feed = new EventFeed()
  private readonly ui = eventView(this.feed)
  private readonly controller = new AbortController()
  private state: ProverState

  constructor(
    private readonly connection: PopupConnection<Message>,
    input: ReturnType<typeof readProver>,
    private readonly hop: { readonly leaving: boolean },
  ) {
    this.state = { phase: 'connecting', input }
  }

  /** Aborted once the run ends, retiring the work it started. */
  private get signal(): AbortSignal {
    return this.controller.signal
  }

  private get ended(): boolean {
    return this.signal.aborted
  }

  async start(): Promise<void> {
    try {
      this.ui.message(messages.proofPreparation)
      this.connection.on(ProveIdentity, (request) => {
        void this.prove(request).catch((error) => this.fail(error))
      })
      // The fallback document continues this ceremony; leaving still ends this run, releasing its capture.
      void this.connection.closed.then((end) => {
        if (end.outcome === 'closed' && this.hop.leaving) {
          if (!this.ended) this.cleanup()
        } else {
          this.fail(endError(end, messages.proverClosed))
        }
      })
      const isolated =
        crossOriginIsolated &&
        typeof SharedArrayBuffer !== 'undefined' &&
        typeof Worker !== 'undefined'
      // When already isolated this document will not hop to fallback; claim root control while
      // connecting, deferring any rejection until the connection is ready to report it.
      const claiming = isolated ? claimRootWorker() : undefined
      claiming?.catch(() => {})
      await this.connection.ready
      if (this.ended) return
      if (!isolated) throw new Error(popupErrorMessages['isolation-unavailable'])
      await claiming
      if (this.ended) return
      if (this.state.phase !== 'connecting') throw new Error(messages.invalidProvingRequest)
      this.state.phase = 'ready'
      if (location.pathname === route('prover/fallback'))
        this.emit({ event: 'prover-fallback', timestamp: performance.timeOrigin })
      this.emit({ event: 'prover', phase: 'started', timestamp: now() })
    } catch (error) {
      this.fail(error)
    }
  }

  private async prove(request: ProveIdentity): Promise<void> {
    if (this.ended) return
    const prover = proverFor(request.platformId, request.platformCeremonyVersion)
    if (this.state.phase !== 'ready' || !prover) throw new Error(messages.invalidProvingRequest)
    const { input } = this.state
    this.state = { phase: 'proving' }
    // Every prover starts from an admitted return, before loading it or using the network.
    const accepted = acceptReturn(prover.platformId, prover.version, request, input)
    if (accepted === null) return this.deny()
    void this.observeDownloads(profileKey(prover.platformId, prover.version))
    try {
      this.ui.trackProof(ceremonyFor(prover.platformId, prover.version).progressWeights)
    } catch {
      /* Presentation cannot prevent proof execution. */
    }
    const module = await prover.load()
    this.signal.throwIfAborted()
    const result = await module.prove({
      request,
      ...accepted,
      signal: this.signal,
      emit: (event) => this.emit(event),
    })
    await this.deliver(result)
  }

  /**
   * How long Prefetch's downloads ran on after proving began. Proving overlaps them, so this
   * bounds, not measures, the wait they caused. Retrievals lost before proving, as with a
   * stopped worker, are `missing`; the Prover fetches them itself, untimed.
   */
  private async observeDownloads(profile: string): Promise<void> {
    const started = performance.now()
    try {
      const { pending, missing } = await remainingDownloads(profile, this.signal)
      const remaining = pending ? performance.now() - started : 0
      this.emit({
        event: 'asset-download',
        timestamp: now(),
        instrumentation: {
          // With anything missing the wait is unknown, never zero.
          attributes: { pending, missing, ...(missing ? {} : { 'remaining-ms': remaining }) },
        },
      })
    } catch {
      /* Observation loss cannot alter proving. */
    }
  }

  private deny(): void {
    this.connection.send({ type: 'user-denied' })
    this.feed.emit({ status: 'denied', timestamp: now() })
    this.cleanup()
  }

  private async deliver(result: ProverResult): Promise<void> {
    if (this.ended) return
    const message = IdentityProof.decode({ type: 'identity-proof', ...result })
    try {
      await this.ui.finishProof()
    } catch {
      /* Presentation cannot prevent proof delivery. */
    }
    if (this.ended) return
    this.connection.send(message)
    this.cleanup()
    this.ui.delivered()
  }

  private emit(event: OperationEvent): void {
    if (this.ended) return
    const message = EventMessage.decode({ type: 'event', ...event })
    try {
      this.connection.send(message)
    } catch (error) {
      if (isCoreEvent(event.event)) {
        this.fail(error)
        return
      }
      // Observation loss cannot alter proving.
    }
    this.feed.emit({ ...event, status: 'active' })
  }

  private fail(error: unknown): void {
    if (this.ended) return
    const failure = ccdpError(error, 'prover')
    this.feed.emit(failureEvent(failure))
    this.cleanup()
    reportFailure(this.connection, failure)
  }

  /** Ending also aborts the prover and stops its UI; later observations are dropped. */
  private cleanup(): void {
    // Failure or leaving before ProveIdentity must release the OAuth capture just as execution does.
    this.state = { phase: 'ended' }
    this.ui.stop()
    this.controller.abort()
  }
}
