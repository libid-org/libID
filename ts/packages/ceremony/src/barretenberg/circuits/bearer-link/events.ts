import type { CoreEvent } from '../../../events.js'
import { proofEvents, proofWeights } from '../../events.js'

/** Core proving operations admitted for every bearer-link platform version; independent of UI weights. */
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
