import { oauthState } from '../../../ccdp/navigation.js'
import { CeremonyError } from '../../../errors.js'
import { responseJson } from '../../../notary/http.js'
import { isRecord } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'
import { proveBearerLink } from '../../bearer-link/prover.js'
import { parseCodeOAuthReturn } from '../../codeReturn.js'
import type { ProverContext } from '../../context.js'
import type { Identity } from '../../types.js'
import {
  buildIdentityRequest,
  buildTokenRequest,
  identityUrl,
  selectIdentity,
  selectToken,
} from './transcript.js'
import type { XProofV1 } from './types.js'

export async function prove(
  context: ProverContext,
): Promise<{ identity: Identity<'x'>; proof: XProofV1 } | null> {
  const { request } = context
  context.signal.throwIfAborted()
  if (!isFormClientId(request.clientId)) throw new Error('Invalid profile client identifier')
  const returned = parseCodeOAuthReturn(context.oauthReturn)
  if (
    !returned ||
    returned.state !== oauthState(context.ceremonyId) ||
    request.codeVerifier === null
  )
    throw new CeremonyError('authorization', 'Invalid X return')
  if (returned.outcome === 'denied') return null
  if (returned.outcome !== 'accepted')
    throw new CeremonyError('authorization', 'X authorization failed')
  const input = {
    clientId: request.clientId,
    code: returned.code,
    redirectUri: request.redirectUri,
    codeVerifier: request.codeVerifier,
  }
  const result = await proveBearerLink(context, {
    tokenRequest: buildTokenRequest(input),
    selectToken: (transcript) => selectToken(transcript, input),
    identityUrl,
    identityRequest: buildIdentityRequest,
    selectIdentity(transcript, bearer) {
      const body = responseJson(transcript),
        selected = selectIdentity(transcript, bearer)
      if (
        !isRecord(body) ||
        !isRecord(body.data) ||
        body.data.id !== selected.userId ||
        body.data.username !== selected.userName
      )
        throw new Error('Invalid identity response')
      return selected
    },
  })
  return {
    ...result,
    identity: { platformId: 'x', oauthClientId: request.clientId, ...result.identity },
  }
}
