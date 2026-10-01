// What an application needs to turn an accepted ceremony into an EVM `bind`
// transaction. Nothing here is published by libID yet.
import type { OAuthProof } from '@libid/ceremony'
import type { LedgerId } from '@libid/ledger'
import {
  type Address,
  bytesToHex,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  numberToHex,
  zeroAddress,
} from 'viem'

/** An EVM ledger: the Chain ID of the EVM Chain Profile, and the notary to route through. */
export function evmLedger(chainId: number | bigint, notaryUrl: string): LedgerId {
  // specs/chain-profiles.md §3.1: keccak256 of the 32-byte big-endian EIP-155 id.
  const hash = hexToBytes(keccak256(numberToHex(BigInt(chainId), { size: 32 })))
  return { hash: () => hash.slice(), notaryAddress: () => notaryUrl }
}

/** The Authorized Transaction Data of `bind`: the holder, and no service fee. */
export function authorizedTransactionData(holder: Address): Uint8Array {
  return hexToBytes(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }],
      [holder, 0n, zeroAddress],
    ),
  )
}

const attestation = [
  { name: 'attestedData', type: 'bytes' },
  { name: 'proof', type: 'bytes' },
] as const

/** `TlsNotaryVerifierBase.TlsNotaryProof`, the payload GitHub and X verifiers decode. */
const tlsNotaryProof = [
  {
    type: 'tuple',
    components: [
      { name: 'ceremonyVersion', type: 'uint16' },
      { name: 'operationDomain', type: 'bytes32' },
      { name: 'authorizationNonce', type: 'bytes32' },
      { name: 'transactionData', type: 'bytes' },
      { name: 'tokenSession', type: 'tuple', components: attestation },
      { name: 'identitySession', type: 'tuple', components: attestation },
      { name: 'proof', type: 'bytes' },
    ],
  },
] as const

/**
 * The `payload` of `IdentityRegistry.bind` for a GitHub or X ceremony. The
 * operation domain and transaction data are the ones the ceremony was started
 * with; the proof does not carry them.
 */
export function encodeTlsNotaryPayload(
  oauthProof: OAuthProof<'github' | 'x'>,
  operationDomain: Uint8Array,
  transactionData: Uint8Array,
): Hex {
  const { proof } = oauthProof
  return encodeAbiParameters(tlsNotaryProof, [
    {
      ceremonyVersion: oauthProof.platformCeremonyVersion,
      operationDomain: bytesToHex(operationDomain),
      authorizationNonce: bytesToHex(oauthProof.authorizationNonce),
      transactionData: bytesToHex(transactionData),
      tokenSession: {
        attestedData: bytesToHex(proof.tokenAttestation.attestedData),
        proof: bytesToHex(proof.tokenAttestation.signature),
      },
      identitySession: {
        attestedData: bytesToHex(proof.identityAttestation.attestedData),
        proof: bytesToHex(proof.identityAttestation.signature),
      },
      proof: bytesToHex(proof.bearerLinkProof),
    },
  ])
}
