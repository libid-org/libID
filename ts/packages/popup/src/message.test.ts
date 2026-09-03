import { describe, expect, it } from 'vitest'
import {
  canonicalOrigin,
  decodeControl,
  isAllowedOrigin,
  isCanonicalHttpsUrl,
  isConnectionId,
  isReservedType,
  MAX_TYPE_LENGTH,
  requireOrigins,
  routingType,
} from './message.js'

const ID = '1c037b6a-2f08-4b17-9f9e-0d9a6a5b3c2d'

describe('connection id [POPUP-CONNECTION-007]', () => {
  it('accepts exact lowercase RFC 4122 UUIDv4 only', () => {
    expect(isConnectionId(ID)).toBe(true)
    for (const bad of [
      ID.toUpperCase(),
      ID.replace('-4b17', '-1b17'), // version
      ID.replace('-9f9e', '-cf9e'), // variant
      `{${ID}}`,
      ID.replaceAll('-', ''),
      `${ID} `,
      '',
      42,
      null,
    ]) {
      expect(isConnectionId(bad)).toBe(false)
    }
  })
})

describe('navigation url [POPUP-CONTROL-002]', () => {
  it('accepts only canonical absolute HTTPS without credentials', () => {
    expect(isCanonicalHttpsUrl('https://popup.example/p#c=1')).toBe(true)
    for (const bad of [
      'http://popup.example/p',
      'https://user:pw@popup.example/p',
      'https://user@popup.example/p',
      '/relative',
      'https://popup.example', // noncanonical: serializes with a trailing slash
      'HTTPS://popup.example/p',
      'https://popup.example/a b',
      'javascript:alert(1)',
      '',
    ]) {
      expect(isCanonicalHttpsUrl(bad)).toBe(false)
    }
  })
})

describe('controls [POPUP-CONTROL-004]', () => {
  it('decodes exact records only', () => {
    expect(decodeControl({ type: 'close-popup' })).toEqual({ type: 'close-popup' })
    expect(decodeControl({ type: 'navigate', url: 'https://p.example/' })).toEqual({
      type: 'navigate',
      url: 'https://p.example/',
    })
    for (const bad of [
      { type: 'close-popup', extra: 1 },
      { type: 'navigate' },
      { type: 'navigate', url: 'http://p.example/' },
      { type: 'navigate', url: 'https://p.example/', extra: 1 },
      { type: 'navigate', url: 1 },
      { type: 'other' },
    ]) {
      expect(decodeControl(bad)).toBeNull()
    }
  })

  it('reserves both discriminators', () => {
    expect(isReservedType('navigate')).toBe(true)
    expect(isReservedType('close-popup')).toBe(true)
    expect(isReservedType('ready')).toBe(false)
  })
})

describe('routing type', () => {
  it('reads a bounded string type from a plain record', () => {
    expect(routingType({ type: 'ready' })).toBe('ready')
    expect(routingType(Object.assign(Object.create(null), { type: 'ready' }))).toBe('ready')
    expect(routingType({ type: 'x'.repeat(MAX_TYPE_LENGTH) })).toHaveLength(MAX_TYPE_LENGTH)
    for (const bad of [
      { type: 'x'.repeat(MAX_TYPE_LENGTH + 1) },
      { type: '' },
      { type: 1 },
      {},
      [],
      new Date(),
      Object.assign(Object.create({ type: 'ready' }), { type: 'ready' }),
      null,
      'ready',
    ]) {
      expect(routingType(bad)).toBeNull()
    }
  })
})

describe('origins', () => {
  it('accepts canonical serializations only', () => {
    expect(canonicalOrigin('https://app.example')).toBe('https://app.example')
    expect(canonicalOrigin('https://app.example:8443')).toBe('https://app.example:8443')
    for (const bad of [
      'https://app.example/',
      'app.example',
      'null',
      'https://app.example:443',
      1,
    ]) {
      expect(canonicalOrigin(bad)).toBeNull()
    }
  })
})

describe('origin sets [POPUP-CONNECTION-009]', () => {
  it('copies a nonempty, duplicate-free set of canonical HTTPS origins', () => {
    const set = requireOrigins(['https://a.example', 'https://b.example:8443'], 'x')
    expect(set).toEqual(['https://a.example', 'https://b.example:8443'])
    expect(Object.isFrozen(set)).toBe(true)
    for (const bad of [
      [],
      ['https://a.example', 'https://a.example'],
      ['http://a.example'],
      ['https://a.example/'],
      ['https://u:p@a.example'],
      ['HTTPS://a.example'],
      ['null'],
      'https://a.example',
      undefined,
    ]) {
      expect(() => requireOrigins(bad, 'x'), JSON.stringify(bad)).toThrow(TypeError)
    }
  })
})

describe('wildcard allowlist [POPUP-CONNECTION-009]', () => {
  it("accepts any canonical HTTPS origin under '*' and nothing else", () => {
    expect(isAllowedOrigin('https://any.example', '*')).toBe(true)
    for (const bad of ['null', 'http://any.example', 'https://any.example/', '', 'file://']) {
      expect(isAllowedOrigin(bad, '*'), bad).toBe(false)
    }
    expect(isAllowedOrigin('https://any.example', ['https://other.example'])).toBe(false)
  })
})
