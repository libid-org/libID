import { identityRequest } from '../../../notary/oauth/identity.js'
import { provider } from './provider.js'

export const identity = identityRequest({
  url: provider.identityUrl,
  headers: provider.identityHeaders,
  platform: provider.platform,
  userId: { field: provider.idField, quoted: provider.quotedId },
  userName: { field: provider.userNameField },
  // The byte selector owns the exact decimal ID. JSON may round a large one, but `Number()`
  // rounds the selected decimal identically, so the parsed root value still cross-checks it.
  isResponse: (body, { userId, userName }) =>
    body[provider.idField] === Number(userId) && body[provider.userNameField] === userName,
})
