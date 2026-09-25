import { Barretenberg, UltraHonkVerifierBackend } from '@aztec/bb.js'
import { readArchive } from '../build/archive.ts'
import { loadAssetCatalog } from '../build/assets.ts'

/** Verify fixture browser output in Node with the released key and reject a changed public input. */
export async function verifyBrowserProof(
  name: string,
  result: { proof: number[]; publicInputs: string[] },
): Promise<void> {
  const catalog = await loadAssetCatalog()
  const circuit = catalog.circuits.find((asset) => asset.member === `${name}.json`)
  if (!circuit) throw new Error('Unknown circuit')
  const files = await readArchive(circuit.source),
    api = await Barretenberg.new({ threads: 1 })
  try {
    const verifier = new UltraHonkVerifierBackend(api)
    const proofData = {
      proof: Uint8Array.from(result.proof),
      publicInputs: result.publicInputs,
      verificationKey: new Uint8Array(files.get('vk')!),
    }
    if (!(await verifier.verifyProof(proofData, { verifierTarget: 'evm' })))
      throw new Error('Released-key verification failed')
    const publicInputs = [...result.publicInputs]
    publicInputs[0] = `0x${(BigInt(publicInputs[0]) ^ 1n).toString(16).padStart(64, '0')}`
    if (await verifier.verifyProof({ ...proofData, publicInputs }, { verifierTarget: 'evm' }))
      throw new Error('Mutated public input was accepted')
  } finally {
    await api.destroy()
  }
}
