import { gunzipSync } from 'node:zlib'
import { BackendType, Barretenberg } from '@aztec-foundation/bb.js'
import {
  CRS_CHUNK_BYTES,
  G1_POINT_BYTES,
  MIN_SRS_POINTS,
  PROVING_SETTINGS,
} from '../src/barretenberg/parameters.ts'

/** Build-time circuit statistics use the pinned EVM proof settings, without SRS downloads. */
export async function validateCircuitCapacity(
  circuits: ReadonlyMap<string, Buffer>,
  srsPoints: number,
) {
  if (
    !Number.isSafeInteger(srsPoints) ||
    srsPoints < MIN_SRS_POINTS ||
    (srsPoints * G1_POINT_BYTES) % CRS_CHUNK_BYTES !== 0
  )
    throw new Error('SRS does not satisfy the pinned browser loader floor')
  const api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1, skipSrsInit: true })
  const stats: Record<string, { gates: number; dyadic: number }> = {}
  try {
    for (const [name, bytes] of circuits) {
      const circuit = JSON.parse(bytes.toString('utf8')) as { bytecode: string }
      const result = await api.circuitStats({
        circuit: {
          name,
          bytecode: gunzipSync(Buffer.from(circuit.bytecode, 'base64')),
          verificationKey: new Uint8Array(),
        },
        includeGatesPerOpcode: false,
        settings: PROVING_SETTINGS,
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
