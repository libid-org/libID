import type { CeremonyEvent } from '../../events.js'

/** UI weights estimate completed work, not elapsed time. Parent operations carry no weight. */
const proofWeights = {
  'proof-worker-bootstrap': 1,
  'proof-circuit-load': 2,
  'proof-wasm-load': 2,
  'proof-backend-initialization': 3,
  'circuit-inputs': 1,
  witness: 3,
  proof: 6,
}

/** One admitted platform's completed proof work, excluding teardown and delivery. */
export function proofProgress(platform: string): (event: CeremonyEvent) => number | undefined {
  const weights = {
    ...proofWeights,
    ...(platform === 'google'
      ? { 'signing-key-fetch': 1 }
      : {
          'token-attestation': platform === 'x' ? 1 : 2,
          'identity-fetch': 2,
          'identity-attestation': 1,
          ...(platform === 'x' ? { 'token-fetch': 2 } : {}),
        }),
  }
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
