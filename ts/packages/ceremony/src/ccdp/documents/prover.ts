import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { route } from '../../assets/keys.js'
import { claimRootWorker } from '../../assets/registration.js'
import { toCeremonyError } from '../../errors.js'
import { EventFeed, failureEvent, isCoreEvent, now, type OperationEvent } from '../../events.js'
import { ceremonyFor } from '../../platforms/index.js'
import { type ProverResult, proverFor } from '../../platforms/provers.js'
import { EventMessage, IdentityProof, ProveIdentity } from '../index.js'
import { readProver } from '../navigation.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { endError, reportFailure } from './failure.js'
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
      fallback,
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: [input.applicationOrigin],
      isolationFallbackUrl: location.origin + route('prover/fallback'),
      onDiagnostic: ({ code }) => {
        if (code === 'isolation-fallback') hop.leaving = true
      },
    })
    await new ProverDocument(connection, input, hop).start()
  } catch (error) {
    const failure = toCeremonyError(error, 'prover')
    view(messages.returnToApplication(failure.message))
    reportFailure(undefined, failure)
  }
}

/** Owns readiness, the one-shot OAuth capture and cleanup for this document. */
class ProverDocument {
  private state: ProverState
  private readonly controller = new AbortController()
  private readonly feed = new EventFeed()
  private readonly ui = eventView(this.feed)

  constructor(
    private readonly connection: PopupConnection<Message>,
    input: ReturnType<typeof readProver>,
    private readonly hop: { readonly leaving: boolean },
  ) {
    this.state = { phase: 'connecting', input }
  }

  async start(): Promise<void> {
    try {
      this.ui.message(messages.proofPreparation)
      this.connection.on(ProveIdentity, (request) => {
        void this.prove(request).catch((error) => this.fail(error))
      })
      void this.connection.closed.then((end) => {
        // The fallback document continues this ceremony; this page is only leaving.
        if (end.outcome === 'closed' && this.hop.leaving) return
        this.fail(endError(end, messages.proverClosed))
      })
      await this.connection.ready
      if (this.controller.signal.aborted) return
      if (
        !crossOriginIsolated ||
        typeof SharedArrayBuffer === 'undefined' ||
        typeof Worker === 'undefined'
      )
        throw new Error(popupErrorMessages['isolation-unavailable'])
      await claimRootWorker()
      if (this.controller.signal.aborted) return
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
    if (this.state.phase === 'ended') return
    const prover = proverFor(request.platformId, request.platformCeremonyVersion)
    if (this.state.phase !== 'ready' || !prover) throw new Error(messages.invalidProvingRequest)
    const { input } = this.state
    this.state = { phase: 'proving' }
    try {
      this.ui.trackProof(ceremonyFor(prover.platformId, prover.version).progressWeights)
    } catch {
      /* Presentation cannot prevent proof execution. */
    }
    const module = await prover.load()
    this.controller.signal.throwIfAborted()
    const result = await module.prove({
      request,
      ceremonyId: input.ceremonyId,
      oauthReturn: input.oauthReturn,
      signal: this.controller.signal,
      emit: (event) => this.emit(event),
    })
    await this.deliver(result)
  }

  private async deliver(result: ProverResult | null): Promise<void> {
    if (this.controller.signal.aborted) return
    if (result === null) {
      this.connection.send({ type: 'user-denied' })
      this.feed.emit({ status: 'denied', timestamp: now() })
      this.cleanup()
      return
    }
    const message = IdentityProof.decode({ type: 'identity-proof', ...result })
    try {
      await this.ui.finishProof()
    } catch {
      /* Presentation cannot prevent proof delivery. */
    }
    if (this.controller.signal.aborted) return
    this.connection.send(message)
    this.cleanup()
    this.ui.delivered()
  }

  private emit(event: OperationEvent): void {
    if (this.state.phase === 'ended') return
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

  private cleanup(): void {
    this.state = { phase: 'ended' }
    this.controller.abort()
    this.ui.stop()
  }

  private fail(error: unknown): void {
    if (this.state.phase === 'ended') return
    const failure = toCeremonyError(error, 'prover')
    this.feed.emit(failureEvent(failure))
    this.cleanup()
    reportFailure(this.connection, failure)
  }
}
