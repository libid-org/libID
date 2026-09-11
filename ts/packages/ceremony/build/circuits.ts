import { gunzipSync } from 'node:zlib'
import { BackendType, Barretenberg } from '@aztec/bb.js'

/** Build-time circuit statistics use the pinned EVM proof settings, without SRS downloads. */
export async function validateCircuitCapacity(
  releases: ReadonlyMap<string, Buffer>,
  srsPoints: number,
) {
  if (
    !Number.isSafeInteger(srsPoints) ||
    srsPoints < 2 ** 17 ||
    (srsPoints * 32) % (4 * 1024 * 1024) !== 0
  )
    throw new Error('SRS does not satisfy the pinned browser loader floor')
  const api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1, skipSrsInit: true })
  const stats: Record<string, { gates: number; dyadic: number }> = {}
  try {
    for (const [name, bytes] of releases) {
      const circuit = JSON.parse(bytes.toString('utf8')) as { bytecode: string }
      const result = await api.circuitStats({
        circuit: {
          name,
          bytecode: gunzipSync(Buffer.from(circuit.bytecode, 'base64')),
          verificationKey: new Uint8Array(),
        },
        includeGatesPerOpcode: false,
        settings: {
          ipaAccumulation: false,
          oracleHashType: 'keccak',
          disableZk: false,
          optimizedSolidityVerifier: false,
        },
      })
      if (result.numGatesDyadic > srsPoints)
        throw new Error(`Circuit exceeds the launch SRS: ${name}`)
      stats[name] = { gates: result.numGates, dyadic: result.numGatesDyadic }
    }
    return stats
  } finally {
    await api.destroy()
  }
}
