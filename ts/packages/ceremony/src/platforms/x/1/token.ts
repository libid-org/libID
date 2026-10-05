import { notarizedToken } from '../../notarized/token.js'
import { provider } from './provider.js'

export const token = notarizedToken({
  url: provider.tokenUrl,
  fields(input) {
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
    }
    return provider.tokenFields.map((field) => [field, values[field]])
  },
})
