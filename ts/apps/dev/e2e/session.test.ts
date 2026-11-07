// The mapping restoreSession applies, on a synthetic export.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cookieParam } from './session.ts'

test('cookies map to addCookies as the export spells them', () => {
  const domain = cookieParam({
    name: 'a',
    value: '1',
    domain: '.x.com',
    sameSite: 'no_restriction',
    expires: 9e9,
  })
  assert.deepEqual(
    [domain.domain, domain.path, domain.sameSite, domain.expires],
    ['.x.com', '/', 'None', 9e9],
  )
  const hostOnly = cookieParam({
    name: 'b',
    value: '2',
    domain: 'x.com',
    path: '/i',
    same_site: '',
    partition_key: { topLevelSite: 'https://x.com' },
  })
  assert.deepEqual(
    [
      hostOnly.domain,
      hostOnly.path,
      'sameSite' in hostOnly,
      hostOnly.expires,
      hostOnly.partitionKey,
    ],
    ['x.com', '/i', false, -1, 'https://x.com'],
  )
})
