// Plumbing shared by the dedicated notary and proof workers and their parents.

import type { OperationEvent } from './events.js'

/** Requested threads, capped at four and the available hardware concurrency. */
export const workerThreads = (requested = 4): number =>
  Math.max(1, Math.min(requested, navigator.hardwareConcurrency || 1, 4))

/** Observers cannot change the outcome of the work they watch. */
export function safeEmit(emit: (event: OperationEvent) => void): (event: OperationEvent) => void {
  return (event) => {
    try {
      emit(event)
    } catch {
      /* Ignored. */
    }
  }
}
