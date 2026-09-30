import { expect, it } from 'vitest'
import { CEREMONY_ID } from '../testing/index.js'
import {
  oauthState,
  prefetchFragment,
  proverFragment,
  readOAuthState,
  readPrefetch,
  readProver,
} from './navigation.js'

const id = CEREMONY_ID

it('reads Prefetch input with or without its hash, bounded and exact [CSP-006]', () => {
  const fragment = String(prefetchFragment(id, 'google', 1))
  expect(readPrefetch(`#${fragment}`)).toEqual({
    ceremonyId: id,
    platformId: 'google',
    platformCeremonyVersion: 1,
  })
  expect(() => readPrefetch(`${fragment}&padding=${'x'.repeat(65536)}`)).toThrow('too large')
  for (const [ceremonyId, platformId, version] of [
    [id.toUpperCase(), 'google', '1'],
    [id, 'Google', '1'],
    [id, 'google', '01'],
    [id, 'google', '-1'],
    [id, 'google', '65536'],
  ])
    expect(() =>
      readPrefetch(
        String(new URLSearchParams({ ceremonyId, platformId, ceremonyVersion: version })),
      ),
    ).toThrow('Invalid Prefetch input')
})

it('reads the OAuth state it writes and any later CCDP version [LIBID-ASSET-015]', () => {
  expect(readOAuthState(oauthState(id))).toEqual({ ccdpVersion: '1', ceremonyId: id })
  expect(readOAuthState(`v2.${id}`)).toEqual({ ccdpVersion: '2', ceremonyId: id })
  for (const state of [`v0.${id}`, `v01.${id}`, `1.${id}`, 'v1.invalid', `v1.${id.toUpperCase()}`])
    expect(readOAuthState(state)).toBeNull()
})

it.each(['https://app.test', 'http://localhost:4681', 'http://127.0.0.1:4681'])(
  'preserves the exact Application origin %s in the private fragment [TEST-CCDP-03]',
  (applicationOrigin) => {
    const fragment = proverFragment(id, applicationOrigin, {
      query: '?code=a%2Bb',
      fragment: '#state=x',
    })
    expect([...fragment.keys()]).toEqual([
      'ceremonyId',
      'applicationOrigin',
      'oauthQuery',
      'oauthFragment',
    ])
    expect(readProver(String(fragment)).applicationOrigin).toBe(applicationOrigin)
    fragment.append('applicationOrigin', applicationOrigin)
    expect(() => readProver(String(fragment))).toThrow()
    fragment.delete('applicationOrigin')
    expect(() => readProver(String(fragment))).toThrow()
  },
)

it.each([
  '',
  '*',
  'null',
  'http://app.test',
  'https://app.test/',
  'https://app.test:443',
  'https://u@app.test',
])(
  'rejects invalid Application origin %s before accepting Prover [TEST-CCDP-04]',
  (applicationOrigin) => {
    expect(() =>
      readProver(String(proverFragment(id, applicationOrigin, { query: '', fragment: '' }))),
    ).toThrow()
  },
)
