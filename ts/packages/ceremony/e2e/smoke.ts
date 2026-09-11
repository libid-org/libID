import { sha256 } from '@noble/hashes/sha2.js'
import { resolve as assetUrl } from '../src/assets/index.js'
import {
  circuit as google,
  verificationKey as googleKey,
} from '../src/platforms/google/1/google.assets.js'
import { buildGoogleWitness } from '../src/barretenberg/circuits/oidc_google/inputs.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../src/barretenberg/circuits/bearer_link/bearer_link.assets.js'
import { buildBearerLinkWitness } from '../src/barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../src/barretenberg/engine.js'
import { Notarization } from '../src/notary/session.js'
import fixture from '../test-fixtures/google-v1.json'

Object.assign(window, {
  async proveFixture(platform: 'google' | 'bearer') {
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
    const inputs =
      platform === 'google'
        ? buildGoogleWitness(fixture.idToken, fixture.jwk).inputs
        : buildBearerLinkWitness(bearer, opening(0), opening(16))
    const engine = new ProofEngine({
      circuitUrl: assetUrl(platform === 'google' ? google : bearerCircuit),
      verificationKeyUrl: assetUrl(platform === 'google' ? googleKey : bearerVerificationKey),
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
  async notarySmoke(count = 2, notaryAddress = 'http://localhost:4687') {
    const abort = new AbortController(),
      engine = new ProofEngine({
        circuitUrl: assetUrl(bearerCircuit),
        verificationKeyUrl: assetUrl(bearerVerificationKey),
        threads: 2,
      })
    const timer = setTimeout(() => abort.abort(new Error('Notary smoke timed out')), 120000)
    try {
      const notary = new Notarization(notaryAddress, abort.signal)
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
      clearTimeout(timer)
      return results
    } finally {
      clearTimeout(timer)
      abort.abort()
      engine.destroy()
    }
  },
})
