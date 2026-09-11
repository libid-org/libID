import { route } from '../ccdp/navigation.js'

/** Activate the canonical root registration and retire only the known legacy nested scope. */
export async function rootWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(route('worker.js'), {
    scope: '/',
    type: 'module',
    updateViaCache: 'none',
  })
  if (registration.scope !== `${location.origin}/`)
    throw new Error('Incorrect Service Worker scope')
  const newest = registration.installing ?? registration.waiting ?? registration.active
  if (newest?.state !== 'activated') {
    const worker = newest
    if (!worker) throw new Error('Missing Service Worker')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Service Worker activation timed out')), 15000)
      const done = (error?: Error) => {
        clearTimeout(timer)
        worker.removeEventListener('statechange', changed)
        error ? reject(error) : resolve()
      }
      const changed = () => {
        if (worker.state === 'activated') done()
        else if (worker.state === 'redundant') done(new Error('Service Worker failed'))
      }
      worker.addEventListener('statechange', changed)
      changed()
    })
  }
  // Retire only the known legacy scope. A root worker cannot claim pages that
  // still match a longer registration; popup port selection alone cannot fix it.
  const script = new URL(route('worker.js'), location.origin).href
  for (const old of await navigator.serviceWorker.getRegistrations()) {
    const workers = [old.active, old.waiting, old.installing].filter(
      (worker): worker is ServiceWorker => worker !== null,
    )
    if (
      old.scope === `${location.origin}/ccdp/v1/` &&
      workers.length &&
      workers.every((worker) => worker.scriptURL === script)
    )
      await old.unregister()
  }
  return registration
}

/** Wait for fetch-dispatch acknowledgement for this profile, not download completion. */
export async function dispatchPrefetch(
  registration: ServiceWorkerRegistration,
  profile: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => done(new Error('Asset dispatch timed out')), 15000)
    const done = (error?: Error) => {
      clearTimeout(timer)
      channel.port1.close()
      error ? reject(error) : resolve()
    }
    channel.port1.onmessage = (event) =>
      event.data?.dispatched === true ? done() : done(new Error('Invalid dispatch acknowledgement'))
    try {
      registration.active!.postMessage({ type: 'ceremony-prefetch', profile }, [channel.port2])
    } catch {
      channel.port2.close()
      done(new Error('Asset dispatch failed'))
    }
  })
}

/** Newly isolated documents can initially be uncontrolled; claim before execution fetches. */
export async function claimRootWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (registration?.scope !== `${location.origin}/` || !registration.active)
    throw new Error('Missing root Service Worker')
  if (navigator.serviceWorker.controller === registration.active) return
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => done(new Error('Service Worker control timed out')), 15000)
    const done = (error?: Error) => {
      clearTimeout(timer)
      channel.port1.close()
      navigator.serviceWorker.removeEventListener('controllerchange', changed)
      error ? reject(error) : resolve()
    }
    const changed = () => {
      if (navigator.serviceWorker.controller === registration.active) done()
    }
    navigator.serviceWorker.addEventListener('controllerchange', changed)
    channel.port1.onmessage = changed
    registration.active!.postMessage({ type: 'ceremony-claim' }, [channel.port2])
    changed()
  })
}
