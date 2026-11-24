// Plumbing shared by the dedicated notary and proof workers and their parents.

/** Per-runtime browser CPU budget, additionally bounded by hardware concurrency. */
const MAX_WORKER_THREADS = 4

/** Refuse single-threaded proving after applying the worker CPU cap. */
export const MIN_PROOF_THREADS = 2

/** Requested threads, capped at four and the available hardware concurrency. */
export const workerThreads = (requested = MAX_WORKER_THREADS): number =>
  Math.max(1, Math.min(requested, navigator.hardwareConcurrency || 1, MAX_WORKER_THREADS))
