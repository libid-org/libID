import { claimRootWorker } from '../../prefetch/registration.js'
import { fallback } from 'virtual:ceremony-popup-fallback'
import { AbortCeremony } from '../index.js'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { AppStartProver, CancelCeremony, ProverNotifyEvent, ProverDeliverProof } from '../index.js'
import { readProver, route } from '../navigation.js'
import { progressView, view } from '../../ui.js'
import type { ProverContext } from '../../prover/context.js'
const implementations: Record<
  string,
  () => Promise<{ prove(context: ProverContext): Promise<unknown | null> }>
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
  const fail = () => {
    if (ended) return
    cleanup()
    view('Unable to complete proof. Return to your application.')
    try {
      connection?.send(AbortCeremony.decode({ type: 'abort-ceremony', reason: 'Proving failed' }))
    } catch {}
  }
  try {
    retained = readProver(fragment)
    ui = progressView()
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
      const context: ProverContext = {
        request,
        ceremonyId: retained!.ceremonyId,
        oauthReturn: retained!.oauthReturn,
        signal: controller.signal,
        onProgress(platformStep, timestamp) {
          if (ended) return
          try {
            const event = ProverNotifyEvent.decode({
              type: 'prover-notify-event',
              platformStep,
              timestamp,
            })
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
        .then((proof) => {
          if (ended) return
          if (proof === null) {
            connection!.send({ type: 'cancel-ceremony' })
            cleanup()
            view('Authorization declined. Return to your application.')
            return
          }
          connection!.send(ProverDeliverProof.decode({ type: 'prover-deliver-proof', proof }))
          ui!.update(1, 'Proof delivered')
          cleanup()
        })
        .catch(fail)
    })
    void connection.closed.then(() => {
      if (!ended) fail()
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
    connection.send({ type: 'prover-ready' })
  } catch {
    fail()
  }
}
