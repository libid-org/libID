import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupError, PopupWindow } from '@libid/popup'
import { claimRootWorker } from '../../assets/registration.js'
import { ceremonyError, reportFailure } from '../../errors.js'
import { type CoreEvent, coreEvents, Events, now, type OperationEvent } from '../../events.js'
import type { ProverContext } from '../../platforms/context.js'
import { implementationFor, type PlatformId } from '../../platforms/index.js'
import { Event as EventMessage, IdentityProof, ProveIdentity } from '../index.js'
import { readProver, route } from '../navigation.js'
import { messages } from '../ui-messages.js'
import { eventView, view } from './ui.js'

const implementations: Record<
  PlatformId,
  () => Promise<{
    prove(context: ProverContext): Promise<Omit<IdentityProof, 'type'> | null>
  }>
> = {
  google: () => import('../../platforms/google/1/prover.js'),
  x: () => import('../../platforms/x/1/prover.js'),
  github: () => import('../../platforms/github/1/prover.js'),
}

type ProverState =
  | { phase: 'connecting' | 'ready'; input: ReturnType<typeof readProver> }
  | { phase: 'proving' | 'ended' }

/** Accept the private callback fragment, run the selected pipeline and deliver one terminal result. */
export async function startProver(fragment: string): Promise<void> {
  try {
    const input = readProver(fragment)
    const connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: input.ceremonyId,
      allowedApplicationOrigins: [input.applicationOrigin],
      isolationFallbackUrl: location.origin + route('prover/fallback'),
    })
    await new ProverDocument(connection, input).start()
  } catch (error) {
    const failure = ceremonyError(error, 'prover')
    view(messages.returnToApplication(failure.message))
    reportFailure(undefined, failure)
  }
}

/** Owns readiness, the one-shot OAuth capture and cleanup for this document. */
class ProverDocument {
  private state: ProverState
  private readonly controller = new AbortController()
  private readonly events = new Events()
  private readonly ui = eventView(this.events, '')

  constructor(
    private readonly connection: PopupConnection<Message>,
    input: ReturnType<typeof readProver>,
  ) {
    this.state = { phase: 'connecting', input }
  }

  async start(): Promise<void> {
    try {
      this.ui.message(messages.proofPreparation)
      this.connection.on(ProveIdentity, (request) => {
        void this.prove(request).catch((error) => this.fail(error))
      })
      void this.connection.closed.then((end) =>
        this.fail(
          end.outcome === 'failed' ? new PopupError(end.code) : new Error(messages.proverClosed),
        ),
      )
      await this.connection.ready
      if (this.controller.signal.aborted) return
      if (
        !crossOriginIsolated ||
        typeof SharedArrayBuffer === 'undefined' ||
        typeof Worker === 'undefined'
      )
        throw new Error(messages.isolationUnavailable)
      await claimRootWorker()
      if (this.controller.signal.aborted) return
      if (this.state.phase !== 'connecting') throw new Error(messages.invalidProvingRequest)
      this.state.phase = 'ready'
      if (location.pathname === route('prover/fallback'))
        this.produce({ event: 'prover-fallback', timestamp: performance.timeOrigin })
      this.produce({ event: 'prover', phase: 'started', timestamp: now() })
    } catch (error) {
      this.fail(error)
    }
  }

  private async prove(request: ProveIdentity): Promise<void> {
    if (this.state.phase === 'ended') return
    if (
      this.state.phase !== 'ready' ||
      request.platformCeremonyVersion !== 1 ||
      !Object.hasOwn(implementations, request.platformId)
    )
      throw new Error(messages.invalidProvingRequest)
    const { input } = this.state
    this.state = { phase: 'proving' }
    try {
      this.ui.trackProof(implementationFor(request.platformId as PlatformId, 1).progressWeights)
    } catch {
      /* Presentation cannot prevent proof execution. */
    }
    const module = await implementations[request.platformId as PlatformId]()
    this.controller.signal.throwIfAborted()
    const result = await module.prove({
      request,
      ceremonyId: input.ceremonyId,
      oauthReturn: input.oauthReturn,
      signal: this.controller.signal,
      emit: (event) => this.produce(event),
    })
    await this.deliver(result)
  }

  private async deliver(result: Omit<IdentityProof, 'type'> | null): Promise<void> {
    if (this.controller.signal.aborted) return
    if (result === null) {
      this.connection.send({ type: 'user-denied' })
      this.events.emit({ status: 'denied', timestamp: now() })
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

  private produce(event: OperationEvent): void {
    if (this.state.phase === 'ended') return
    const message = EventMessage.decode({ type: 'event', ...event })
    try {
      this.connection.send(message)
    } catch (error) {
      if (coreEvents.includes(event.event as CoreEvent)) {
        this.fail(error)
        return
      }
      // Observation loss cannot alter proving.
    }
    this.events.emit({ ...event, status: 'active' })
  }

  private cleanup(): void {
    this.state = { phase: 'ended' }
    this.controller.abort()
    this.ui.stop()
  }

  private fail(error: unknown): void {
    if (this.state.phase === 'ended') return
    const failure = ceremonyError(error, 'prover')
    this.events.emit({
      status: 'failed',
      event: failure.event,
      message: failure.message,
      timestamp: now(),
    })
    this.cleanup()
    reportFailure(this.connection, failure)
  }
}
