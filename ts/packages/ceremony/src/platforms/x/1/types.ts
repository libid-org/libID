import { hasExactKeys, isRecord } from '../../../primitives.js'
import {
  type Identity,
  type NotaryAttestation,
  isIdentity,
  isAttestation,
  proofBytes,
} from '../../types.js'
export interface XProofV1 {
  identity: Identity<'x'>
  bearerLinkProof: Uint8Array
  tokenAttestation: NotaryAttestation
  identityAttestation: NotaryAttestation
}
export function validateProof(v: unknown): XProofV1 {
  if (
    !isRecord(v) ||
    !hasExactKeys(v, ['identity', 'bearerLinkProof', 'tokenAttestation', 'identityAttestation']) ||
    !isIdentity(v.identity, 'x', [512, 20, 15]) ||
    !proofBytes(v.bearerLinkProof) ||
    !isAttestation(v.tokenAttestation) ||
    !isAttestation(v.identityAttestation)
  )
    throw new TypeError('Invalid X proof')
  return v as unknown as XProofV1
}
