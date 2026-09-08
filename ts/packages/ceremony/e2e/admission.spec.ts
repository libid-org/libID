import { expect, test } from '@playwright/test'

test('Bridge config admits its effective origins without exposing the allowlist [KIT-004] [KIT-005]', async ({
  request,
}) => {
  for (const origin of [
    'https://localhost:4681',
    'https://localhost:4683',
    'https://other.test',
    'null',
    undefined,
  ]) {
    const response = await request.get('https://localhost:4682/api/v1/ceremony/config', {
      headers: origin === undefined ? {} : { Origin: origin },
    })
    const admitted = origin === 'https://localhost:4681' || origin === 'https://localhost:4683'
    expect(response.status()).toBe(admitted ? 200 : 403)
    expect(response.headers()['access-control-allow-origin']).toBe(admitted ? origin : undefined)
    if (admitted) {
      expect(Object.keys(await response.json()).sort()).toEqual([
        'ccdpOrigin',
        'platforms',
        'redirectUri',
      ])
      expect(response.headers().vary).toBe('Origin')
    }
  }
})
