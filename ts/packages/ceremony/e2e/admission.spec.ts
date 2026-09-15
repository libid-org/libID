import { expect, test } from './fixtures.js'

test('Bridge config admits its effective origins without exposing the allowlist [KIT-004] [KIT-005]', async ({
  request,
  app,
  bridge,
  ccdp,
}) => {
  for (const [origin, site] of [
    [app, 'cross-site'],
    [ccdp, undefined],
    ['https://other.test', 'same-origin'],
    ['null', 'same-origin'],
    [undefined, undefined],
    [undefined, 'same-origin'],
    [undefined, 'same-site'],
    [undefined, 'cross-site'],
    [undefined, 'none'],
  ]) {
    const response = await request.get(`${bridge}/api/v1/ceremony/config`, {
      headers: {
        ...(origin === undefined ? {} : { Origin: origin }),
        ...(site === undefined ? {} : { 'Sec-Fetch-Site': site }),
      },
    })
    const admitted =
      origin === app || origin === ccdp || (origin === undefined && site === 'same-origin')
    expect(response.status()).toBe(admitted ? 200 : 403)
    expect(response.headers()['access-control-allow-origin']).toBe(admitted ? origin : undefined)
    if (admitted) {
      expect(Object.keys(await response.json()).sort()).toEqual(['ccdpOrigin', 'platforms'])
      expect(response.headers().vary).toBe('Origin, Sec-Fetch-Site')
    }
  }
})
