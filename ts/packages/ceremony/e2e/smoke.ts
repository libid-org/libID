import { sha256 } from '@noble/hashes/sha2.js'
import { resolve as assetUrl } from '../src/assets/index.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../src/barretenberg/circuits/bearer_link/bearer_link.assets.js'
import { buildBearerLinkWitness } from '../src/barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../src/barretenberg/engine.js'
import { Notarization } from '../src/notary/session.js'

Object.assign(window, {
  async proveBearerFixture() {
    const bearer = `AAAA${'x'.repeat(96)}`
    const opening = (start: number) => {
      const blinder = Uint8Array.from({ length: 16 }, (_, i) => i + start)
      return {
        start: 0,
        end: 100,
        blinder,
        hash: sha256(Uint8Array.from([...new TextEncoder().encode(bearer), ...blinder])),
      }
    }
    const inputs = buildBearerLinkWitness(bearer, opening(0), opening(16))
    const engine = new ProofEngine({
      circuitUrl: assetUrl(bearerCircuit),
      verificationKeyUrl: assetUrl(bearerVerificationKey),
      threads: 2,
    })
    try {
      const result = await engine.prove(inputs)
      return {
        proof: Array.from(result.proof),
        publicInputs: result.publicInputs,
        runtime: result.runtime,
      }
    } finally {
      engine.destroy()
    }
  },
  async notarizeRequests(count: number) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(new Error('Notary smoke timed out')), 120000)
    try {
      const notary = new Notarization('http://localhost:4987', abort.signal)
      const results = await Promise.all(
        Array.from({ length: count }, async () => {
          const url = 'https://api.x.com/2/users/me',
            session = await notary.prepare(url)
          const transcript = await session.send({
            url,
            method: 'GET',
            headers: {
              Host: new TextEncoder().encode('api.x.com'),
              Connection: new TextEncoder().encode('close'),
            },
            body: new Uint8Array(),
          })
          const result = await session.reveal({
            sent: [{ start: 0, end: transcript.sent.length }],
            received: [{ start: 0, end: transcript.received.length }],
          })
          const attestation = await result.attestation
          return {
            sent: transcript.sent.length,
            received: transcript.received.length,
            attestedData: attestation.attestedData.length,
          }
        }),
      )
      return results
    } finally {
      clearTimeout(timer)
      abort.abort()
    }
  },
})
