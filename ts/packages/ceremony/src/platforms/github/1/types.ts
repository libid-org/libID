import { hasExactKeys, isRecord } from '../../../primitives.js'
import { isFormClientId } from '../../authorization.js'
import {
  type Identity,
  isAttestation,
  isIdentity,
  isUserId,
  type NotaryAttestation,
  proofBytes,
} from '../../types.js'

export interface GitHubProofV1 {
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}

export function validateProof(v: unknown): GitHubProofV1 {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['bearerLinkProof', 'tokenAttestation', 'identityAttestation']) ||
    !proofBytes(v.bearerLinkProof) ||
    !isAttestation(v.tokenAttestation) ||
    !isAttestation(v.identityAttestation)
  )
    throw new TypeError('Invalid GitHub proof')
  return v as unknown as GitHubProofV1
}

export function validateIdentity(value: unknown): Identity<'github'> {
  if (
    !isIdentity(value, 'github', [512, 20, 39]) ||
    !isFormClientId(value.oauthClientId) ||
    !isUserId(value.userId) ||
    !isUserName(value.userName)
  )
    throw new TypeError('Invalid github identity')
  return value
}

export const isUserName = (value: string): boolean =>
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value) && !value.includes('--')
