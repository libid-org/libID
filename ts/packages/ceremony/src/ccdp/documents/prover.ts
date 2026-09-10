import { fallback } from 'virtual:ceremony-popup-fallback'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { ceremonyError, type FailureCode, reportFailure } from '../../errors.js'
import { claimRootWorker } from '../../prefetch/registration.js'
import type { ProverContext } from '../../prover/context.js'
import { progressView, view } from '../../ui.js'
import { AppStartProver, CancelCeremony, ProverIdentityProof, ProverNotifyEvent } from '../index.js'
import { readProver, route } from '../navigation.js'

const implementations: Record<
  string,
  () => Promise<{
    prove(context: ProverContext): Promise<Omit<ProverIdentityProof, 'type'> | null>
  }>
> = {
  google: () => import('../../platforms/google/1/prover.js'),
  x: () => import('../../platforms/x/1/prover.js'),
  github: () => import('../../platforms/github/1/prover.js'),
}
export async function startProver(fragment: string): Promise<void> {
  let connection: PopupConnection<Message> | undefined,
    retained: ReturnType<typeof readProver> | undefined,
    started = false,
    ended = false,
    ready = false
  const controller = new AbortController()
  let ui: ReturnType<typeof progressView> | undefined,
    last = 0
  const cleanup = () => {
    ended = true
    retained = undefined
    controller.abort()
    ui?.stop()
  }
  let failureCode: FailureCode = 'prover-input'
  const fail = (error?: unknown) => {
    if (ended) return
    const failure = ceremonyError(error, failureCode)
    cleanup()
    view(`${failure.message} (${failure.code}) Return to your application.`)
    reportFailure(connection, failure)
  }
  try {
    retained = readProver(fragment)
    ui = progressView()
    failureCode = 'prover-connection'
    connection = PopupConnection.accept(PopupWindow.current(fragment, { scope: '/' }), {
      fallback,
      connectionId: retained.ceremonyId,
      allowedApplicationOrigins: '*',
      isolationFallbackUrl: location.origin + route('prover/fallback'),
    })
    connection.on(CancelCeremony, () => {
      if (ended) return
      cleanup()
      view('Canceled. Return to your application.')
    })
    connection.on(AppStartProver, (request) => {
      if (ended) return
      failureCode = 'prover-request'
      if (
        !ready ||
        started ||
        request.platformCeremonyVersion !== 1 ||
        !Object.hasOwn(implementations, request.platformId)
      ) {
        fail()
        return
      }
      started = true
      failureCode = 'prover-execution'
      const context: ProverContext = {
        request,
        ceremonyId: retained!.ceremonyId,
        oauthReturn: retained!.oauthReturn,
        signal: controller.signal,
        onStage(stage) {
          if (ended) return
          try {
            connection!.send(
              ProverNotifyEvent.decode({
                type: 'prover-notify-event',
                stage,
                timestamp: performance.timeOrigin + performance.now(),
              }),
            )
          } catch {
            /* Advisory stage reporting cannot decide the result. */
          }
        },
        onProgress(platformStep, timestamp) {
          if (ended) return
          try {
            const event = ProverNotifyEvent.decode({
              type: 'prover-notify-event',
              platformStep,
              timestamp,
            })
            if (!('platformStep' in event)) return
            if (platformStep.code === 'witness' && platformStep.status === 'started')
              context.onStage('proof-generation')
            if (event.platformStep.progress < last) return
            last = event.platformStep.progress
            ui!.update(last, platformStep.label)
            connection!.send(event)
          } catch {
            /* Invalid advisory progress cannot decide the result. */
          }
        },
      }
      retained = undefined
      void implementations[request.platformId as keyof typeof implementations]()
        .then((module) => module.prove(context))
        .then((result) => {
          if (ended) return
          if (result === null) {
            connection!.send({ type: 'cancel-ceremony' })
            cleanup()
            view('Authorization declined. Return to your application.')
            return
          }
          connection!.send(ProverIdentityProof.decode({ type: 'prover-identity-proof', ...result }))
          ui!.update(1, 'Proof delivered')
          cleanup()
        })
        .catch(fail)
    })
    void connection.closed.then(() => {
      if (!ended) fail(ceremonyError(undefined, 'prover-connection'))
    })
    await connection.ready
    if (ended) return
    failureCode = 'prover-isolation'
    if (
      !crossOriginIsolated ||
      typeof SharedArrayBuffer === 'undefined' ||
      typeof Worker === 'undefined'
    )
      throw new Error('Prover isolation unavailable')
    failureCode = 'prover-worker'
    await claimRootWorker()
    if (ended) return
    ready = true
    connection.send({ type: 'prover-ready' })
  } catch (error) {
    fail(error)
  }
}
