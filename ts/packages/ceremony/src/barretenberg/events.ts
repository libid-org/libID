/** Core operations emitted by the Barretenberg pipeline. */
export const proofEvents = ['zk-proof-preparation', 'zk-proof-generation'] as const

/** Presentation weights estimate work; they are not elapsed durations. */
export const proofWeights = {
  'proof-worker-bootstrap': 1,
  'proof-circuit-load': 2,
  'proof-wasm-load': 2,
  'proof-backend-initialization': 3,
  'circuit-inputs': 1,
  witness: 3,
  proof: 6,
}
