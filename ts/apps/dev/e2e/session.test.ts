// The mapping restoreSession applies, on a synthetic export.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cookieParams } from './session.ts'

test('cookies map to addCookies as the export spells them', () => {
  const exported = [
    { name: 'a', value: '1', domain: '.x.com', sameSite: 'no_restriction', expires: 9e9 },
    {
      name: 'b',
      value: '2',
      domain: 'x.com',
      path: '/i',
      same_site: '',
      partitionKey: 'https://x.com',
    },
  ]
  const [domain, copy, hostOnly] = cookieParams(exported, (d) =>
    d[0] === '.' ? [d, '.twitter.com'] : [d],
  )
  assert.deepEqual(
    [domain?.domain, domain?.path, domain?.sameSite, domain?.expires, copy?.domain],
    ['.x.com', '/', 'None', 9e9, '.twitter.com'],
  )
  assert.deepEqual(
    [
      hostOnly?.domain,
      hostOnly?.path,
      'sameSite' in hostOnly!,
      hostOnly?.expires,
      hostOnly?.partitionKey,
    ],
    ['x.com', '/i', false, -1, 'https://x.com'],
  )
})
