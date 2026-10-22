// A synthetic `ceremony export` through the mapping restoreSession applies.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cookieParams, onGoogle, onX, parseExport, type Stored } from './session.ts'

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
  const [domain] = cookieParams(exported)
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
  const [, hostOnly] = cookieParams(exported)
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
  const [, , host] = cookieParams(exported)
  assert.equal(host?.url, 'https://accounts.google.com/')
  assert.equal(host && ('domain' in host || 'path' in host), false)
  assert.equal(host?.expires, NOW + 60)
  assert.equal(host && 'partitionKey' in host, false)
})

test('each cookie goes on every domain given', () => {
  const params = cookieParams(exported.slice(0, 3), (domain) => [
    domain,
    domain.replace('x.com', 'twitter.com'),
  ])
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

test("an export keeps the platform's unexpired cookies, as a list or under `cookies`", () => {
  const list = JSON.stringify(exported)
  assert.deepEqual(
    parseExport(list, onX, NOW)?.map((cookie) => cookie.name),
    ['auth_token', 'ct0'],
  )
  assert.deepEqual(
    parseExport(JSON.stringify({ cookies: exported, origins: [] }), onGoogle, NOW)?.map(
      (cookie) => cookie.name,
    ),
    ['__Host-GAPS'],
  )
  const lookalike = JSON.stringify([
    { name: 'SID', value: 'fake', domain: 'evilgoogle.com' },
    { name: 'SID', value: 'fake', domain: '.google.com' },
  ])
  assert.deepEqual(
    parseExport(lookalike, onGoogle, NOW)?.map((cookie) => cookie.domain),
    ['.google.com'],
  )
  assert.equal(parseExport('{"cookies": 1}', onX, NOW), undefined)
  assert.equal(parseExport('not json', onX, NOW), undefined)
})

test('an export entry is a cookie only with string name, value and domain', () => {
  const capitalised = JSON.stringify([
    { Name: 'auth_token', Value: 'fake', Domain: '.x.com', Path: '/', Secure: true },
  ])
  const [cookie] = parseExport(capitalised, onX, NOW) ?? []
  assert.equal(cookie?.name, 'auth_token')
  assert.equal(cookie?.domain, '.x.com')
  assert.equal(cookie?.path, '/')
  for (const bad of [
    '[null]',
    '["auth_token"]',
    '[{"name":"auth_token","value":"fake"}]',
    '[{"name":"auth_token","value":1,"domain":".x.com"}]',
  ])
    assert.equal(parseExport(bad, onX, NOW), undefined, bad)
})
