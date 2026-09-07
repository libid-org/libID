import { hasExactKeys, isRecord } from '../../../primitives.js'
import {
  type Identity,
  type NotaryAttestation,
  isIdentity,
  isAttestation,
  proofBytes,
} from '../../types.js'
export interface GitHubProofV1 {
  identity: Identity<'github'>
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}
export function validateProof(v: unknown): GitHubProofV1 {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['identity', 'bearerLinkProof', 'tokenAttestation', 'identityAttestation']) ||
    !isIdentity(v.identity, 'github', [512, 20, 39]) ||
    !proofBytes(v.bearerLinkProof) ||
    !isAttestation(v.tokenAttestation) ||
    !isAttestation(v.identityAttestation)
  )
    throw new TypeError('Invalid GitHub proof')
  return v as unknown as GitHubProofV1
}
