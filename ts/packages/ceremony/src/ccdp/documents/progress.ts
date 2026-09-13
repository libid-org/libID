import type { CeremonyEvent } from '../../events.js'

/** Account for a platform's declared UI work without assigning meaning to event names. */
export function proofProgress(
  weights: Readonly<Record<string, number>>,
): (event: CeremonyEvent) => number | undefined {
  const remaining = new Map<string, number>(Object.entries(weights))
  const total = [...remaining.values()].reduce((sum, weight) => sum + weight, 0)
  let completed = 0
  return (event) => {
    if (
      event.status !== 'active' ||
      event.phase !== 'finished' ||
      event.instrumentation?.operationId !== undefined
    )
      return
    const weight = remaining.get(event.event)
    if (weight === undefined) return
    remaining.delete(event.event)
    completed += weight
    return completed / total
  }
}
