import { isFormClientId } from '../../authorization.js'
import { hasExactKeys, isRecord } from '../../../primitives.js'
import {
  type Identity,
  type NotaryAttestation,
  isIdentity,
  isUserId,
  isAttestation,
  proofBytes,
} from '../../types.js'
export interface XProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}
export function validateProof(v: unknown): XProofV1 {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['bearerLinkProof', 'tokenAttestation', 'identityAttestation']) ||
    !proofBytes(v.bearerLinkProof) ||
    !isAttestation(v.tokenAttestation) ||
    !isAttestation(v.identityAttestation)
  )
    throw new TypeError('Invalid X proof')
  return v as unknown as XProofV1
}

export function validateIdentity(value: unknown): Identity<'x'> {
  if (
    !isIdentity(value, 'x', [512, 20, 15]) ||
    !isFormClientId(value.oauthClientId) ||
    !isUserId(value.userId) ||
    !isUserName(value.userName)
  )
    throw new TypeError('Invalid x identity')
  return value
}

export const isUserName = (value: string): boolean => /^[A-Za-z0-9_]{1,15}$/.test(value)
