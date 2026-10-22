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
  // snake_case, host-only, a path, a session cookie, partitioned by site alone.
  {
    name: 'ct0',
    value: 'v2',
    domain: 'x.com',
    path: '/i',
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

test('a domain cookie keeps its domain and path; of its partition, the site', () => {
  const [domain] = cookieParams(exported, undefined, NOW)
  assert.deepEqual(domain, {
    name: 'auth_token',
    value: 'v1',
    domain: '.x.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    expires: NOW + 60,
    // Playwright takes the top-level site alone: hasCrossSiteAncestor (false
    // in the export) is not expressible, and Playwright sends true.
    partitionKey: 'https://x.com',
  })
  assert.equal(domain && 'hasCrossSiteAncestor' in domain, false)
})

test('a host-only cookie goes on its host, without a dot, with its exact path', () => {
  const [, hostOnly] = cookieParams(exported, undefined, NOW)
  assert.deepEqual(hostOnly, {
    name: 'ct0',
    value: 'v2',
    domain: 'x.com',
    path: '/i',
    secure: true,
    httpOnly: false,
    sameSite: 'Lax',
    expires: -1,
    partitionKey: 'https://x.com',
  })
})

test('a __Host- cookie is placed by url alone', () => {
  const [, , host] = cookieParams(exported, undefined, NOW)
  assert.equal(host?.url, 'https://accounts.google.com/')
  assert.equal(host && ('domain' in host || 'path' in host), false)
  assert.equal(host?.expires, NOW + 60)
  assert.equal(host && 'partitionKey' in host, false)
})

test('expired cookies are left out; each cookie goes on every domain given', () => {
  const params = cookieParams(
    exported,
    (domain) => [domain, domain.replace('x.com', 'twitter.com')],
    NOW,
  )
  assert.ok(!params.some((param) => param.name === 'old'))
  assert.deepEqual(
    params.map((param) => param.domain ?? param.url),
    [
      '.x.com',
      '.twitter.com',
      'x.com',
      'twitter.com',
      'https://accounts.google.com/',
      'https://accounts.google.com/',
    ],
  )
})
