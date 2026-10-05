import { isBearer } from '../../barretenberg/circuits/bearer-link/inputs.js'
import { MAX_BEARER_BYTES } from '../../barretenberg/circuits/bearer-link/parameters.js'
import { isRedirectUri } from '../../ccdp/index.js'
import { type TokenLayout, tokenRequest } from '../../notary/oauth/token.js'
import { isPkceValue } from '../authorization.js'

/** A PKCE code flow's token request, whose bearer the bearer-link circuit proves. */
export const notarizedToken = (layout: Omit<TokenLayout, 'acceptsInput' | 'bearer'>) =>
  tokenRequest({
    ...layout,
    acceptsInput: (input) => isRedirectUri(input.redirectUri) && isPkceValue(input.codeVerifier),
    bearer: { maxBytes: MAX_BEARER_BYTES, valid: isBearer },
  })
