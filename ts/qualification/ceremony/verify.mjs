import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readArchive } from '../../packages/ceremony/build/archive.ts'
import { loadAssetCatalog } from '../../packages/ceremony/build/assets.ts'

const require = createRequire(new URL('../../packages/ceremony/package.json', import.meta.url))
export async function verifyBrowserProof(name, result) {
  const { Barretenberg, UltraHonkVerifierBackend } = require('@aztec/bb.js')
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
      verificationKey: new Uint8Array(files.get('vk')),
    }
    if (!(await verifier.verifyProof(proofData, { verifierTarget: 'evm' })))
      throw new Error('Released-key verification failed')
    const publicInputs = [...result.publicInputs]
    publicInputs[0] = `0x${(BigInt(publicInputs[0]) ^ 1n).toString(16).padStart(64, '0')}`
    if (await verifier.verifyProof({ ...proofData, publicInputs }, { verifierTarget: 'evm' }))
      throw new Error('Mutated public input was accepted')
    return true
  } finally {
    await api.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyBrowserProof(process.argv[2], JSON.parse(readFileSync(process.argv[3], 'utf8')))
  console.log('Released-key verification and mutation rejection passed')
}
