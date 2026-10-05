// The root Service Worker script, served at its content-addressed /ccdp/worker.{sha256}.js.
import { startRootWorker } from './rootWorker.js'

startRootWorker(self as unknown as ServiceWorkerGlobalScope)
