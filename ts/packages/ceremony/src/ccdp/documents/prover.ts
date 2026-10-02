import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { route } from '../../assets/keys.js'
import { claimRootWorker } from '../../assets/registration.js'
import { isCoreEvent, now, type OperationEvent } from '../../events.js'
import { ceremonyFor } from '../../platforms/index.js'
import { acceptReturn } from '../../platforms/oauthReturn.js'
import { type ProverResult, proverFor } from '../../platforms/provers.js'
import { ccdpError, reportFailure } from '../failure.js'
import { EventMessage, IdentityProof, ProveIdentity } from '../index.js'
import { readProver } from '../navigation.js'
import { messages, popupErrorMessages } from '../uiMessages.js'
import { CeremonyDocument } from './document.js'
import { view } from './ui.js'

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

/** Owns readiness, the one-shot OAuth capture and its admission, and proof delivery. */
class ProverDocument extends CeremonyDocument {
  private state: ProverState
  private readonly controller = new AbortController()

  constructor(
    protected readonly connection: PopupConnection<Message>,
    input: ReturnType<typeof readProver>,
    private readonly hop: { readonly leaving: boolean },
  ) {
    super('prover')
    this.state = { phase: 'connecting', input }
  }

  async start(): Promise<void> {
    try {
      this.ui.message(messages.proofPreparation)
      this.connection.on(ProveIdentity, (request) => {
        void this.prove(request).catch((error) => this.fail(error))
      })
      // The fallback document continues this ceremony; this page is only leaving.
      this.failOnEnd(messages.proverClosed, (end) => end.outcome === 'closed' && this.hop.leaving)
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
    if (this.ended) return
    const prover = proverFor(request.platformId, request.platformCeremonyVersion)
    if (this.state.phase !== 'ready' || !prover) throw new Error(messages.invalidProvingRequest)
    const { input } = this.state
    this.state = { phase: 'proving' }
    // Every prover starts from an admitted return, before loading it or using the network.
    const accepted = acceptReturn(prover.platformId, prover.version, request, input)
    if (accepted === null) return this.deny()
    try {
      this.ui.trackProof(ceremonyFor(prover.platformId, prover.version).progressWeights)
    } catch {
      /* Presentation cannot prevent proof execution. */
    }
    const module = await prover.load()
    this.controller.signal.throwIfAborted()
    const result = await module.prove({
      request,
      ...accepted,
      signal: this.controller.signal,
      emit: (event) => this.emit(event),
    })
    await this.deliver(result)
  }

  private deny(): void {
    this.connection.send({ type: 'user-denied' })
    this.feed.emit({ status: 'denied', timestamp: now() })
    this.cleanup()
  }

  private async deliver(result: ProverResult): Promise<void> {
    if (this.controller.signal.aborted) return
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

  /** Ending also aborts the prover; its later observations are dropped. */
  protected override cleanup(): void {
    // Failure before ProveIdentity must release the OAuth capture just as execution does.
    this.state = { phase: 'ended' }
    super.cleanup()
    this.controller.abort()
  }
}
