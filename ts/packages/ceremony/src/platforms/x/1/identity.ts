import { identityRequest } from '../../../notary/oauth/identity.js'
import { isRecord } from '../../../primitives.js'
import { decimalUserId } from '../../validation.js'
import { provider } from './provider.js'
import { isUserName, MAX_USER_NAME_BYTES } from './validation.js'

export const identity = identityRequest({
  url: provider.identityUrl,
  headers: provider.identityHeaders,
  userId: { ...decimalUserId, field: provider.idField, quoted: provider.quotedId },
  userName: { field: provider.userNameField, maxBytes: MAX_USER_NAME_BYTES, valid: isUserName },
  isResponse: ({ data }, { userId, userName }) =>
    isRecord(data) &&
    data[provider.idField] === userId &&
    data[provider.userNameField] === userName,
})
