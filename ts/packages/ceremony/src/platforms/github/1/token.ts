import { isClientCredential } from '../../../ccdp/index.js'
import { notarizedToken } from '../../notarized/token.js'
import { provider } from './provider.js'

export const token = notarizedToken({
  url: provider.tokenUrl,
  fields(input) {
    if (!isClientCredential(input.clientCredential)) throw new Error('Invalid token request')
    const values: Record<string, string> = {
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_secret: input.clientCredential,
    }
    return provider.tokenFields.map((field) => [field, values[field]])
  },
})
