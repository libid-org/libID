import type { CoreEvent } from '../../events.js'

/** The token and identity sessions, each fetched then attested. */
export const oauthEvents = [
  'token-fetch',
  'token-attestation',
  'identity-fetch',
  'identity-attestation',
] as const satisfies readonly CoreEvent[]

export const oauthWeights = {
  'token-fetch': 2,
  'token-attestation': 1,
  'identity-fetch': 2,
  'identity-attestation': 1,
}
