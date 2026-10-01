// The root Service Worker script served at /ccdp/v1/worker.js.
import { startRootWorker } from './rootWorker.js'

startRootWorker(self as unknown as ServiceWorkerGlobalScope)
