import { proofEvents, proofWeights } from '../../barretenberg/events.js'
import type { CoreEvent } from '../../events.js'
import { oauthEvents, oauthWeights } from '../../notary/oauth/events.js'

/** Core proving operations admitted for every notarized platform version; independent of UI weights. */
export const events: readonly CoreEvent[] = [...proofEvents, ...oauthEvents]

export const progressWeights = { ...proofWeights, ...oauthWeights }
