import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { claimRootWorker } from '../../assets/registration.js'
import { ceremonyError, reportFailure } from '../../errors.js'
import { type CoreEvent, coreEvents, Events, now, type OperationEvent } from '../../events.js'
import type { ProverContext } from '../../platforms/context.js'
import { Cancel, Event as EventMessage, IdentityProof, ProveIdentity } from '../index.js'
import { readProver, route } from '../navigation.js'
import { eventView, view } from './ui.js'

const implementations: Record<
  string,
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
    ui.message('Preparing your identity proof')
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: retained.ceremonyId,
      allowedApplicationOrigins: '*',
      isolationFallbackUrl: location.origin + route('prover/fallback'),
    })
    connection.on(Cancel, () => {
      if (ended) return
      events.emit({ status: 'cancelled', timestamp: now() })
      cleanup()
    })
    connection.on(ProveIdentity, (request) => {
      if (ended) return
      if (
        !ready ||
        started ||
        request.platformCeremonyVersion !== 1 ||
        !Object.hasOwn(implementations, request.platformId)
      ) {
        fail(new Error('Invalid proving request'))
        return
      }
      started = true
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
        .then((result) => {
          if (ended) return
          if (result === null) {
            connection!.send({ type: 'cancel' })
            events.emit({ status: 'denied', timestamp: now() })
            cleanup()
            return
          }
          connection!.send(IdentityProof.decode({ type: 'identity-proof', ...result }))
          view('Proof delivered. Return to your application.')
          cleanup()
        })
        .catch(fail)
    })
    void connection.closed.then(() => {
      if (!ended) fail(new Error('Prover connection closed'))
    })
    await connection.ready
    if (ended) return
    if (
      !crossOriginIsolated ||
      typeof SharedArrayBuffer === 'undefined' ||
      typeof Worker === 'undefined'
    )
      throw new Error('Prover isolation unavailable')
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
