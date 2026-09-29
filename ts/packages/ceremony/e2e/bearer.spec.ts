import { testnet } from '@libid/ledger/testing'
import { decodeAttestedData } from '../src/notary/decode.js'
import {
  deriveAuthorizationDigest,
  deriveCodeChallenge,
  deriveCodeVerifier,
} from '../src/platforms/authorization.js'
import { artifactRequests, expect, test } from './fixtures.js'
import { verifyBrowserProof } from './verify.js'

for (const platform of ['x', 'github'] as const)
  for (const corrupt of [false, true])
    test(`${platform} browser ceremony with fixture TLSN: ${corrupt ? 'rejects changed final attestation' : 'accepts independently verified proof'} [LIBID-PROVER-003] [LIBID-PROVER-004] [TEST-CCDP-07] ${corrupt ? '' : '[TEST-COMMON-20] [TEST-COMMON-22]'} @proof`, async ({
      bridge,
      page,
      context,
      request,
      assetControl,
      launch,
    }) => {
      test.setTimeout(480000)
      // Only OAuth and the TLSN SDK/peer are synthetic. Actual emitted documents,
      // popup continuity, session worker, witness/proof generation and Client run.
      const asset = artifactRequests(`${platform}/1`).find((a) => a.url.endsWith('/tlsn_wasm.js'))!
      expect(
        (
          await request.get(`${assetControl(asset.url)}&tlsn=${corrupt ? 'invalid' : 'valid'}`)
        ).ok(),
      ).toBe(true)
      let challenge: string | null = null
      await context.route(
        platform === 'x'
          ? 'https://x.com/i/oauth2/authorize**'
          : 'https://github.com/login/oauth/authorize**',
        async (route) => {
          const params = new URL(route.request().url()).searchParams
          expect(params.get('client_id')).toBe(`${platform}-fixture`)
          expect(params.get('code_challenge_method')).toBe('S256')
          challenge = params.get('code_challenge')
          const returned = new URLSearchParams({
            code: 'fixture-code',
            state: params.get('state')!,
          })
          if (platform === 'github') returned.set('iss', 'https://github.com/login/oauth')
          await route.fulfill({
            contentType: 'text/html',
            body: `<script>location.replace(${JSON.stringify(`${bridge}/auth/callback?${returned}`)})</script>`,
          })
        },
      )
      const popup = await launch(`?platform=${platform}`)
      await page.waitForFunction(() => window.result, undefined, { timeout: 420000 })
      expect(await page.evaluate(() => window.result?.status)).toBe(corrupt ? 'failed' : 'accepted')
      const events = await page.evaluate(() => window.events)
      expect(events.filter((event) => event.status !== 'active')).toHaveLength(1)
      expect(events.at(-1)?.status).toBe(corrupt ? 'failed' : 'completed')
      expect(await popup.evaluate(() => location.hash)).toBe('')
      expect(await popup.evaluate(() => crossOriginIsolated)).toBe(true)
      if (corrupt) {
        expect(events.at(-1)).toMatchObject({
          message: expect.stringContaining('attested authority changed'),
        })
        expect(['token-attestation', 'identity-attestation']).toContain(
          await page.evaluate(() => window.failureEvent),
        )
        expect(
          events.some(
            (event) => 'phase' in event && event.event === 'prover' && event.phase === 'finished',
          ),
        ).toBe(false)
        expect(await page.evaluate(() => window.completed)).toEqual([])
        return
      }
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
        oauthClientId: `${platform}-fixture`,
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
      expect(challenge).toBe(deriveCodeChallenge(verifier))
      expect(form.get('client_id')).toBe(`${platform}-fixture`)
      expect(form.get('code')).toBe('fixture-code')
      expect(form.get('redirect_uri')).toBe(`${bridge}/auth/callback`)
      if (platform === 'github') expect(form.get('client_secret')).toBe('fixture-public-credential')
      // Verify against commitments actually delivered in the two final attestations,
      // not fixture-known hashes. Synthetic notary signatures are not verified here.
      expect(token.received.revealed).toHaveLength(2)
      const [prefix, suffix] = token.received.revealed
      const bearer = token.received.commitments.filter(
        (c) => c.start === prefix.start + prefix.bytes.length && c.end === suffix.start,
      )
      expect(bearer).toHaveLength(1)
      expect(identity.sent.commitments).toHaveLength(1)
      const publicInputs = [
        ...bearer[0].commitment,
        ...identity.sent.commitments[0].commitment,
      ].map((byte) => `0x${byte.toString(16).padStart(64, '0')}`)
      await verifyBrowserProof('bearer_link', { proof: result.proof, publicInputs })
    })
