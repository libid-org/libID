import { sha256 } from '@noble/hashes/sha2.js'
import { resolve as assetUrl } from '../src/assets/index.js'
import {
  bearerCircuit,
  bearerVerificationKey,
} from '../src/barretenberg/circuits/bearer_link/bearer_link.assets.js'
import { buildBearerLinkWitness } from '../src/barretenberg/circuits/bearer_link/inputs.js'
import { ProofEngine } from '../src/barretenberg/engine.js'
import { Notarization } from '../src/notary/session.js'
import { buildTokenRequest } from '../src/platforms/github/1/token.js'
import { identityRequest } from '../src/platforms/github/1/transcript.js'

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
  async notarizeRequests(count: number, platform: 'x' | 'github' = 'x') {
    const abort = new AbortController()
    const pending = Array.from({ length: count }, () => 'prepare')
    const timer = setTimeout(
      () =>
        abort.abort(
          new Error(
            `Notary smoke timed out: ${JSON.stringify({ platform, hardwareConcurrency: navigator.hardwareConcurrency, pending })}`,
          ),
        ),
      120000,
    )
    try {
      const notary = new Notarization('http://localhost:4987', abort.signal)
      const results = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          // Deliberately invalid fixture credentials exercise both public GitHub endpoints,
          // not a successful OAuth exchange or authenticated identity.
          const request =
            platform === 'github'
              ? index === 0
                ? buildTokenRequest({
                    clientId: 'fixture',
                    code: 'fixture',
                    redirectUri: 'http://localhost:4682/auth/callback',
                    codeVerifier: 'A'.repeat(43),
                    clientCredential: 'fixture',
                  })
                : identityRequest('fixture')
              : {
                  url: 'https://api.x.com/2/users/me',
                  method: 'GET' as const,
                  headers: {
                    Host: new TextEncoder().encode('api.x.com'),
                    Connection: new TextEncoder().encode('close'),
                  },
                  body: new Uint8Array(),
                }
          const session = await notary.prepare(request.url)
          pending[index] = 'send'
          const transcript = await session.send(request)
          pending[index] = 'reveal'
          const result = await session.reveal({
            sent: [{ start: 0, end: transcript.sent.length }],
            received: [{ start: 0, end: transcript.received.length }],
          })
          pending[index] = 'attestation'
          const attestation = await result.attestation
          pending[index] = 'done'
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
