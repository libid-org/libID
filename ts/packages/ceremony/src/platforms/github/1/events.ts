import { proofEvents, proofWeights } from '../../../barretenberg/events.js'
import type { CoreEvent } from '../../../events.js'

/** Core proving operations admitted for this platform version; independent of UI weights. */
export const events: readonly CoreEvent[] = [
  ...proofEvents,
  'token-fetch',
  'token-attestation',
  'identity-fetch',
  'identity-attestation',
]

export const progressWeights = {
  ...proofWeights,
  'token-fetch': 2,
  'token-attestation': 1,
  'identity-fetch': 2,
  'identity-attestation': 1,
}
