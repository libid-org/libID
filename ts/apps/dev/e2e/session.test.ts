// A synthetic `ceremony export` through the mapping restoreSession applies.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cookieParams, type Stored } from './session.ts'

const NOW = 1_800_000_000

const exported: Stored[] = [
  // CDP's camelCase, a domain cookie, with a partition as CDP reports it.
  {
    name: 'auth_token',
    value: 'v1',
    domain: '.x.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
    expires: NOW + 60,
    partitionKey: { topLevelSite: 'https://x.com', hasCrossSiteAncestor: false },
  },
  // snake_case, host-only, no path, a session cookie, partitioned by site alone.
  {
    name: 'ct0',
    value: 'v2',
    domain: 'x.com',
    http_only: false,
    same_site: 'Lax',
    expires: 0,
    partition_key: 'https://x.com',
  },
  // A __Host- cookie, unpartitioned, with `expirationDate`.
  { name: '__Host-GAPS', value: 'v3', domain: 'accounts.google.com', expirationDate: NOW + 60 },
  // Expired: left out.
  { name: 'old', value: 'v4', domain: '.x.com', expires: NOW - 1 },
]

test('a domain cookie keeps its domain, path and partition', () => {
  assert.deepEqual(cookieParams(exported, undefined, NOW)[0], {
    name: 'auth_token',
    value: 'v1',
    domain: '.x.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    expires: NOW + 60,
    partitionKey: 'https://x.com',
  })
})

test('host-only and __Host- cookies are placed by url alone', () => {
  const [, hostOnly, host] = cookieParams(exported, undefined, NOW)
  assert.deepEqual(hostOnly, {
    name: 'ct0',
    value: 'v2',
    url: 'https://x.com/',
    secure: true,
    httpOnly: false,
    sameSite: 'Lax',
    expires: -1,
    partitionKey: 'https://x.com',
  })
  assert.equal(host?.url, 'https://accounts.google.com/')
  assert.equal(host && 'domain' in host, false)
  assert.equal(host?.expires, NOW + 60)
  assert.equal(host && 'partitionKey' in host, false)
})

test('expired cookies are left out; each cookie goes on every domain given', () => {
  const params = cookieParams(
    exported,
    (domain) => [domain, domain.replace('x.com', 'twitter.com')],
    NOW,
  )
  assert.equal(params.length, 6)
  assert.ok(!params.some((param) => param.name === 'old'))
  assert.deepEqual(
    params.map((param) => param.domain ?? param.url),
    [
      '.x.com',
      '.twitter.com',
      'https://x.com/',
      'https://twitter.com/',
      'https://accounts.google.com/',
      'https://accounts.google.com/',
    ],
  )
})
