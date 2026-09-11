import { expect, test } from './fixtures.js'

test('Bridge config admits its effective origins without exposing the allowlist [KIT-004] [KIT-005]', async ({
  request,
  app,
  bridge,
  ccdp,
}) => {
  for (const origin of [app, ccdp, 'https://other.test', 'null', undefined]) {
    const response = await request.get(`${bridge}/api/v1/ceremony/config`, {
      headers: origin === undefined ? {} : { Origin: origin },
    })
    const admitted = origin === app || origin === ccdp
    expect(response.status()).toBe(admitted ? 200 : 403)
    expect(response.headers()['access-control-allow-origin']).toBe(admitted ? origin : undefined)
    if (admitted) {
      expect(Object.keys(await response.json()).sort()).toEqual([
        'callbackPath',
        'ccdpOrigin',
        'platforms',
      ])
      expect(response.headers().vary).toBe('Origin')
    }
  }
})
