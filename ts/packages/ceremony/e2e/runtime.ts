import { sha256 } from '@noble/hashes/sha2.js'
import { assetUrl } from '../src/assets/index.js'
import {
  circuit,
  verificationKey,
} from '../src/barretenberg/circuits/bearer-link/bearerLink.assets.js'
import { buildBearerLinkInputs } from '../src/barretenberg/circuits/bearer-link/inputs.js'
import { ProofEngine } from '../src/barretenberg/engine.js'
import type { ExactHttpRequest } from '../src/notary/protocol.js'
import { NotaryRuntime } from '../src/notary/session.js'
import { identity } from '../src/platforms/github/1/identity.js'
import { token } from '../src/platforms/github/1/token.js'
import type { NotaryPlatform } from './platforms.js'
import { notary, origins } from './topology.js'

/** The index-th unauthenticated request of a real-notary run, per table platform with sessions. */
const notaryRequests: { [P in NotaryPlatform]: (index: number) => ExactHttpRequest } = {
  x: () => ({
    url: 'https://api.x.com/2/users/me',
    method: 'GET',
    headers: {
      Host: new TextEncoder().encode('api.x.com'),
      Connection: new TextEncoder().encode('close'),
    },
    body: new Uint8Array(),
  }),
  // Invalid fixture credentials exercise both public GitHub endpoints; a successful OAuth
  // exchange and an authenticated identity stay live-qualification cases.
  github: (index) =>
    index === 0
      ? token.build({
          clientId: 'fixture',
          code: 'fixture',
          redirectUri: `${origins(false).bridge}/auth/callback`,
          codeVerifier: 'A'.repeat(43),
          clientCredential: 'fixture',
        })
      : identity.build('fixture'),
}

Object.assign(window, {
  NotaryRuntime,
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
    const inputs = buildBearerLinkInputs(bearer, opening(0), opening(16))
    const engine = new ProofEngine({
      circuitUrl: assetUrl(circuit),
      verificationKeyUrl: assetUrl(verificationKey),
      threads: 2,
    })
    try {
      const { proof, publicInputs } = await engine.prove(inputs)
      return { proof: Array.from(proof), publicInputs }
    } finally {
      engine.destroy()
    }
  },
  async notarizeRequests(count: number, platform: NotaryPlatform = 'x') {
    const abort = new AbortController()
    const started = performance.now()
    const pending = Array.from({ length: count }, () => 'prepare')
    const timer = setTimeout(
      () =>
        abort.abort(
          new Error(
            `Notary runtime timed out: ${JSON.stringify({ platform, hardwareConcurrency: navigator.hardwareConcurrency, pending })}`,
          ),
        ),
      120000,
    )
    try {
      const notarization = new NotaryRuntime(`http://localhost:${notary}`, abort.signal)
      return await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const request = notaryRequests[platform](index)
          const session = await notarization.prepare(request.url)
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
    } catch (error) {
      // These are unauthenticated fixture requests. Report only operation positions
      // and elapsed time, including when the production deadline wins first.
      throw new Error(
        `${error instanceof Error ? error.message : 'Notarization failed'}; notary runtime: ${JSON.stringify({ platform, pending, elapsedMs: Math.round(performance.now() - started), hardwareConcurrency: navigator.hardwareConcurrency })}`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
      abort.abort()
    }
  },
})
