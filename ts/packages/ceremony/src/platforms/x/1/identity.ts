import { identityRequest } from '../../../notary/oauth/identity.js'
import { isRecord } from '../../../primitives.js'
import { provider } from './provider.js'

export const identity = identityRequest({
  url: provider.identityUrl,
  headers: provider.identityHeaders,
  platform: provider.platform,
  userId: { field: provider.idField, quoted: provider.quotedId },
  userName: { field: provider.userNameField },
  isResponse: ({ data }, { userId, userName }) =>
    isRecord(data) &&
    data[provider.idField] === userId &&
    data[provider.userNameField] === userName,
})
