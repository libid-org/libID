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
import { eventView } from './ui.js'

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

/** Accept the private callback fragment, run the selected pipeline and deliver one terminal result. */
export async function startProver(fragment: string): Promise<void> {
  let connection: PopupConnection<Message> | undefined,
    retained: ReturnType<typeof readProver> | undefined,
    started = false,
    ended = false,
    ready = false
  const controller = new AbortController()
  const events = new Events()
  let ui: ReturnType<typeof eventView> | undefined
  const cleanup = () => {
    ended = true
    retained = undefined
    controller.abort()
    ui?.stop()
  }
  const fail = (error?: unknown) => {
    if (ended) return
    const failure = ceremonyError(error, 'prover')
    events.emit({
      status: 'failed',
      event: failure.event,
      message: failure.message,
      timestamp: now(),
    })
    cleanup()
    reportFailure(connection, failure)
  }
  function produce(event: OperationEvent): void {
    if (ended) return
    const message = EventMessage.decode({ type: 'event', ...event })
    if (coreEvents.includes(event.event as CoreEvent)) {
      try {
        connection!.send(message)
      } catch (error) {
        fail(error)
        return
      }
    } else
      try {
        connection!.send(message)
      } catch {
        /* Observation loss cannot alter proving. */
      }
    events.emit({ ...event, status: 'active' })
  }
  try {
    retained = readProver(fragment)
    ui = eventView(events, '')
    ui.message(messages.proofPreparation)
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: retained.ceremonyId,
      allowedApplicationOrigins: [retained.applicationOrigin],
      isolationFallbackUrl: location.origin + route('prover/fallback'),
    })

    connection.on(ProveIdentity, (request) => {
      if (ended) return
      if (
        !ready ||
        started ||
        request.platformCeremonyVersion !== 1 ||
        !Object.hasOwn(implementations, request.platformId)
      ) {
        fail(new Error(messages.invalidProvingRequest))
        return
      }
      started = true
      try {
        ui!.trackProof(implementationFor(request.platformId as PlatformId, 1).progressWeights)
      } catch {
        /* Presentation cannot prevent proof execution. */
      }
      const context: ProverContext = {
        request,
        ceremonyId: retained!.ceremonyId,
        oauthReturn: retained!.oauthReturn,
        signal: controller.signal,
        emit: (event) => produce(event),
      }
      retained = undefined
      void implementations[request.platformId as keyof typeof implementations]()
        .then((module) => module.prove(context))
        .then(async (result) => {
          if (ended) return
          if (result === null) {
            connection!.send({ type: 'user-denied' })
            events.emit({ status: 'denied', timestamp: now() })
            cleanup()
            return
          }
          const message = IdentityProof.decode({ type: 'identity-proof', ...result })
          try {
            await ui!.finishProof()
          } catch {
            /* Presentation cannot prevent proof delivery. */
          }
          if (ended) return
          connection!.send(message)
          cleanup()
          ui!.delivered()
        })
        .catch(fail)
    })
    void connection.closed.then((end) => {
      if (!ended)
        fail(end.outcome === 'failed' ? new PopupError(end.code) : new Error(messages.proverClosed))
    })
    await connection.ready
    if (ended) return
    if (
      !crossOriginIsolated ||
      typeof SharedArrayBuffer === 'undefined' ||
      typeof Worker === 'undefined'
    )
      throw new Error(messages.isolationUnavailable)
    await claimRootWorker()
    if (ended) return
    ready = true
    if (location.pathname === route('prover/fallback'))
      produce({ event: 'prover-fallback', timestamp: performance.timeOrigin })
    produce({ event: 'prover', phase: 'started', timestamp: now() })
  } catch (error) {
    fail(error)
  }
}
