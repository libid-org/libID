import { expect, it } from 'vitest'
import { MAX_EXP_DIGITS } from '../../../barretenberg/circuits/oidc_google/parameters.js'
import { googleV1 as fixture, jwtPart, jwtWith } from '../../../testing/index.js'
import { acceptGoogleIdToken } from './token.js'

it('accepts an expiry of as many digits as the circuit reads [TEST-PLAT-06]', () => {
  const { aud, ...claims } = jwtPart(fixture.idToken, 1) as { aud: string }
  const exp = 10 ** MAX_EXP_DIGITS - 1
  const idToken = jwtWith(fixture.idToken, { payload: { ...claims, aud, exp } })
  expect(acceptGoogleIdToken(idToken, aud).claims.exp).toBe(exp)
})
