import { isClientCredential } from '../../../ccdp/index.js'
import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError } from '../../../errors.js'
import { responseJson } from '../../../notary/http.js'
import { isRecord } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'
import { proveBearerLink } from '../../bearer-link/prover.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import { buildTokenRequest, selectToken } from './token.js'
import { identityRequest, selectIdentity } from './transcript.js'
import type { GitHubProofV1 } from './types.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'github'>; proof: GitHubProofV1 } | null> {
  const { request } = context
  const { clientCredential } = request
  context.signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn, 'https://github.com/login/oauth')
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new CeremonyError('authorization', 'Invalid GitHub return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'GitHub authorization failed')
  if (!isClientCredential(clientCredential))
    throw new CeremonyError('token-fetch', 'Missing GitHub public token-exchange credential')
  const input = {
    clientId: request.clientId,
    code: returned.code,
    redirectUri: request.redirectUri,
    codeVerifier: request.codeVerifier,
    clientCredential,
  }
  const result = await proveBearerLink(context, {
    tokenRequest: buildTokenRequest(input),
    selectToken: (transcript) => selectToken(transcript, input),
    identityUrl: 'https://api.github.com/user',
    identityRequest,
    selectIdentity(transcript, bearer) {
      const body = responseJson(transcript, true),
        selected = selectIdentity(transcript, bearer)
      if (
        !isRecord(body) ||
        typeof body.id !== 'bigint' ||
        body.id.toString() !== selected.userId ||
        body.login !== selected.userName
      )
        throw new Error('Invalid GitHub identity')
      return selected
    },
  })
  return {
    ...result,
    identity: { platformId: 'github', oauthClientId: request.clientId, ...result.identity },
  }
}
