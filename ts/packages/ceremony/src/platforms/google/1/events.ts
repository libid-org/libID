import { proofEvents, proofWeights } from '../../../barretenberg/events.js'
import type { CoreEvent } from '../../../events.js'

/** Core proving operations admitted for this platform version; independent of UI weights. */
export const events: readonly CoreEvent[] = [...proofEvents]

export const progressWeights = {
  ...proofWeights,
  'signing-key-fetch': 1,
}
