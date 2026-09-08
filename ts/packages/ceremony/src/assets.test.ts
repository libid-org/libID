import { afterEach, expect, it, vi } from 'vitest'
import * as assets from './assets.js'

vi.mock('virtual:ceremony-assets', () => ({
  urls: {
    'tlsn/v1/snippets/web-spawn-*/js/spawn.js':
      '/ccdp/assets/tlsn/v1/snippets/web-spawn-abcd/js/spawn.js',
  },
}))
afterEach(() => vi.unstubAllGlobals())
it('resolves exact build matches at the executing origin without fetching [LIBID-ASSET-025]', () => {
  vi.stubGlobal('location', { origin: 'https://ccdp.test', pathname: '/ccdp/v1/prover' })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const member = assets
    .archive('https://release.test/tlsn.tar.gz', 'tlsn/v1')
    .member('snippets/web-spawn-*/js/spawn.js', assets.headers.executionWorker)
  expect(assets.resolve(member)).toBe(
    'https://ccdp.test/ccdp/assets/tlsn/v1/snippets/web-spawn-abcd/js/spawn.js',
  )
  const external = assets.external('https://cdn.test/g1.dat', { range: 'bytes=0-31' })
  expect(assets.resolve(external)).toBe(external.source)
  expect(external.range).toBe('bytes=0-31')
  expect(fetch).not.toHaveBeenCalled()
})
