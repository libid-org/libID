import { generateKeyPairSync, sign } from 'node:crypto'
import { testnet } from '@libid/ledger/testing'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { decodeAttestedData } from '../src/notary/decode.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../src/platforms/authorization.js'
import fixture from '../src/platforms/google/1/google-v1.fixture.json' with { type: 'json' }
import type { GoogleProofV1 } from '../src/platforms/google/1/validation.js'
import { buildGooglePublicInputs } from '../src/platforms/google/1/validation.js'
import type { PlatformId } from '../src/platforms/index.js'
import { artifactRequests, expect, expectIsolatedProver, type Fixtures, test } from './fixtures.js'
import { type BrowserPlatform, browserPlatforms, platformIds } from './platforms.js'
import { verifyBrowserProof } from './verify.js'

type Harness = Pick<Fixtures, 'bridge' | 'assetControl' | 'authorize'> & {
  context: BrowserContext
  request: APIRequestContext
}

/** One kind of synthetic evidence a table platform's fixture ceremonies run under. */
interface Evidence {
  /** Title parts: the substituted evidence, the corruption rejected, and each case's requirements. */
  source: string
  corruption: string
  requirements: { accepted: string; corrupted: string }
  /** How a corrupted ceremony ends: its failure text and failing operation. */
  failure: { message: string; events: readonly string[] }
  /** Answer authorization with accepted or corrupted evidence; resolves to the accepted-proof check. */
  arrange(
    platform: PlatformId,
    corrupt: boolean,
    harness: Harness,
  ): Promise<(page: Page) => Promise<void>>
}

const evidence = {
  // Only OAuth and the TLSN SDK/peer are synthetic. Actual emitted documents,
  // popup continuity, session worker, witness/proof generation and Client run.
  tlsn: {
    source: 'fixture TLSN',
    corruption: 'rejects changed final attestation',
    requirements: {
      accepted:
        '[LIBID-PROVER-003] [LIBID-PROVER-004] [TEST-CCDP-07] [TEST-COMMON-20] [TEST-COMMON-22]',
      corrupted: '[LIBID-PROVER-003] [LIBID-PROVER-004] [TEST-CCDP-07]',
    },
    failure: {
      message: 'attested authority changed',
      events: ['token-attestation', 'identity-attestation'],
    },
    async arrange(platform, corrupt, { bridge, request, assetControl, authorize }) {
      const { clientId, clientCredential } = browserPlatforms[platform]
      const asset = artifactRequests(`${platform}/1`).find((a) => a.url.endsWith('/tlsn_wasm.js'))!
      expect(
        (
          await request.get(`${assetControl(asset.url)}&tlsn=${corrupt ? 'invalid' : 'valid'}`)
        ).ok(),
      ).toBe(true)
      const authorizations = await authorize(platform, { code: 'fixture-code' })
      return async (page) => {
        const result = await page.evaluate(() => {
          const result = window.result
          if (result?.status !== 'accepted' || !('bearerLinkProof' in result.oauthProof.proof))
            throw new Error('Missing bearer proof')
          const proof = result.oauthProof.proof
          return {
            identity: result.identity,
            nonce: Array.from(result.oauthProof.authorizationNonce),
            authorizationDigest: Array.from(result.oauthProof.authorizationDigest),
            proof: Array.from(proof.bearerLinkProof),
            token: Array.from(proof.tokenAttestation.attestedData),
            identityAttestation: Array.from(proof.identityAttestation.attestedData),
          }
        })
        expect(result.identity).toEqual({
          platformId: platform,
          oauthClientId: clientId,
          userId: '9007199254740993',
          userName: 'alice',
        })
        const token = decodeAttestedData(Uint8Array.from(result.token))
        const identity = decodeAttestedData(Uint8Array.from(result.identityAttestation))
        expect(token.sent.commitments).toEqual([])
        expect(token.sent.revealed).toHaveLength(1)
        const sent = new TextDecoder().decode(token.sent.revealed[0].bytes)
        const form = new URLSearchParams(sent.split('\r\n\r\n')[1])
        const nonce = Uint8Array.from(result.nonce)
        const digest = deriveAuthorizationDigest({
          operationDomain: new Uint8Array(32),
          platformCeremonyVersion: 1,
          chainId: testnet.hash(),
          authorizationNonce: nonce,
          transactionData: new Uint8Array([1]),
        })
        expect(Uint8Array.from(result.authorizationDigest)).toEqual(digest)
        const verifier = deriveCodeVerifier(digest, nonce)
        expect(form.get('code_verifier')).toBe(verifier)
        expect(authorizations.at(-1)?.get('code_challenge')).toBe(deriveCodeChallenge(verifier))
        expect(form.get('client_id')).toBe(clientId)
        expect(form.get('code')).toBe('fixture-code')
        expect(form.get('redirect_uri')).toBe(`${bridge}/auth/callback`)
        expect(form.get('client_secret')).toBe(clientCredential ?? null)
        // Verify against commitments actually delivered in the two final attestations,
        // not fixture-known hashes. Synthetic notary signatures are not verified here.
        expect(token.received.revealed).toHaveLength(2)
        const [prefix, suffix] = token.received.revealed
        const bearer = token.received.commitments.filter(
          (c) => c.start === prefix.start + prefix.bytes.length && c.end === suffix.start,
        )
        expect(bearer).toHaveLength(1)
        expect(identity.sent.commitments).toHaveLength(1)
        const publicInputs = [...bearer[0].hash, ...identity.sent.commitments[0].hash].map(
          (byte) => `0x${byte.toString(16).padStart(64, '0')}`,
        )
        await verifyBrowserProof('bearer_link', { proof: result.proof, publicInputs })
      }
    },
  },
  // A synthetic issuer signs the fixture claims with the application's live nonce; proving and
  // verification are real. This is not real consent or Google's own signing key.
  jwt: {
    source: 'fixture JWT',
    corruption: 'rejects changed JWT signature',
    requirements: {
      accepted: '[LIBID-PROVER-001] [CSP-020] [TEST-COMMON-20] [TEST-COMMON-22]',
      corrupted: '[LIBID-PROVER-002]',
    },
    // Neither browser endpoint checks the signature; witness execution fails the circuit's RS256 constraint.
    failure: { message: 'Cannot satisfy constraint', events: ['witness'] },
    async arrange(platform, corrupt, { context, authorize }) {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
      const jwk = { ...publicKey.export({ format: 'jwk' }), kid: fixture.jwk.kid }
      // WebKit's controlled-page fetch bypasses Playwright routing. Substitute only
      // this public JWKS fixture at the page boundary; all proof assets use real loaders.
      // This does not qualify the live JWKS endpoint's CORS/CSP behavior.
      await context.addInitScript((key) => {
        Date.now = () => 1725001000000
        const fetch = window.fetch
        window.fetch = (...args) =>
          String(args[0]) === 'https://www.googleapis.com/oauth2/v3/certs'
            ? Promise.resolve(
                new Response(JSON.stringify({ keys: [key] }), {
                  headers: { 'Content-Type': 'application/json' },
                }),
              )
            : fetch(...args)
      }, jwk)
      const requests = await authorize(platform, (request) => {
        const [header, original] = fixture.idToken.split('.')
        const claims = JSON.parse(Buffer.from(original, 'base64url').toString())
        const payload = Buffer.from(JSON.stringify({ ...claims, nonce: request.get('nonce') }))
        const signed = `${header}.${payload.toString('base64url')}`
        const signature = sign('RSA-SHA256', Buffer.from(signed), privateKey)
        // One flipped signature bit; the header, claims and signing key stay valid.
        if (corrupt) signature[signature.length - 1] ^= 1
        return {
          id_token: `${signed}.${signature.toString('base64url')}`,
          // Provider metadata the return rules do not interpret must pass through.
          version_info: 'synthetic',
          provider_meta: 'future',
          'release.rev': '1',
        }
      })
      return async (page) => {
        const result = await page.evaluate(() => {
          const result = window.result
          if (
            result?.status !== 'accepted' ||
            result.identity.platformId !== 'google' ||
            !('signingKeyModulus' in result.oauthProof.proof)
          )
            throw new Error('Missing Google proof')
          const proof = result.oauthProof.proof
          return {
            identity: result.identity,
            authorizationDigest: Array.from(result.oauthProof.authorizationDigest),
            ...proof,
            identityProof: Array.from(proof.identityProof),
            signingKeyModulus: Array.from(proof.signingKeyModulus),
          }
        })
        expect(result.identity).toEqual({
          platformId: platform,
          oauthClientId: browserPlatforms[platform].clientId,
          userId: '0x20078023c9d4bf6bffc2580ec36446075d10c8453cecbe4f1cb3d326b2b35560',
          userName: 'holder@example.com',
        })
        const proof: GoogleProofV1 = {
          tokenExpiresAt: result.tokenExpiresAt,
          publicInputs: result.publicInputs,
          identityProof: Uint8Array.from(result.identityProof),
          signingKeyModulus: Uint8Array.from(result.signingKeyModulus),
        }
        const digest = Uint8Array.from(result.authorizationDigest)
        expect(Buffer.from(digest).toString('base64url')).toBe(requests.at(-1)?.get('nonce'))
        expect(proof.publicInputs).toEqual(buildGooglePublicInputs(digest, result.identity, proof))
        await verifyBrowserProof('oidc_google', {
          proof: result.identityProof,
          publicInputs: [...proof.publicInputs],
        })
      }
    },
  },
} satisfies Record<BrowserPlatform['evidence'], Evidence>

for (const platform of platformIds) {
  const { source, corruption, requirements, failure, arrange } =
    evidence[browserPlatforms[platform].evidence]

  test(`${platform} bound denial crosses the actual popup and private Callback [TEST-CCDP-07]`, async ({
    page,
    authorize,
    launch,
  }) => {
    await authorize(platform, { error: 'access_denied' })
    const popup = await launch(`?platform=${platform}`)
    await expect.poll(() => page.evaluate(() => window.result)).toEqual({ status: 'denied' })
    await expectIsolatedProver(popup)
    expect(
      await page.evaluate(() =>
        window.events.some((event) => 'event' in event && event.event === 'token-fetch'),
      ),
    ).toBe(false)
  })

  for (const corrupt of [false, true])
    test(`${platform} browser ceremony with ${source}: ${corrupt ? `${corruption} ${requirements.corrupted}` : `accepts independently verified proof ${requirements.accepted}`} @proof`, async ({
      bridge,
      page,
      context,
      request,
      assetControl,
      authorize,
      launch,
    }) => {
      test.setTimeout(480000)
      const verify = await arrange(platform, corrupt, {
        bridge,
        context,
        request,
        assetControl,
        authorize,
      })
      const popup = await launch(`?platform=${platform}`)
      await page.waitForFunction(() => window.result, undefined, { timeout: 420000 })
      const events = await page.evaluate(() => window.events)
      const status = await page.evaluate(() => window.result?.status)
      if (status !== (corrupt ? 'failed' : 'accepted')) console.log('Fixture progress:', events)
      expect(status).toBe(corrupt ? 'failed' : 'accepted')
      expect(events.filter((event) => event.status !== 'active')).toHaveLength(1)
      expect(events.at(-1)?.status).toBe(corrupt ? 'failed' : 'completed')
      await expectIsolatedProver(popup)
      if (!corrupt) return verify(page)
      expect(events.at(-1)).toMatchObject({ message: expect.stringContaining(failure.message) })
      expect(failure.events).toContain(await page.evaluate(() => window.failureEvent))
      expect(
        events.some(
          (event) => 'phase' in event && event.event === 'prover' && event.phase === 'finished',
        ),
      ).toBe(false)
      expect(await page.evaluate(() => window.completed)).toEqual([])
    })
}
