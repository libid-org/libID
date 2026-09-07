import { describe, expect, it } from 'vitest'
import { b64urlDecode, b64urlEncode, bytesEqual, hasExactKeys, isRecord } from './primitives.js'

const utf8 = (s: string) => new TextEncoder().encode(s)

describe('b64url codec', () => {
  // RFC 4648 §10 vectors, unpadded.
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ]

  it('encodes the RFC 4648 vectors unpadded', () => {
    for (const [plain, encoded] of vectors) {
      expect(b64urlEncode(utf8(plain))).toBe(encoded)
    }
  })

  it('decodes the RFC 4648 vectors', () => {
    for (const [plain, encoded] of vectors) {
      expect(b64urlDecode(encoded)).toEqual(utf8(plain))
    }
  })

  it('uses the url-safe alphabet', () => {
    // 0xfb 0xef 0xbe encodes to '++++'/'////' territory in plain base64.
    expect(b64urlEncode(new Uint8Array([0xfb, 0xef, 0xbe]))).toBe('----')
    expect(b64urlEncode(new Uint8Array([0xff, 0xff, 0xff]))).toBe('____')
    expect(b64urlDecode('____')).toEqual(new Uint8Array([0xff, 0xff, 0xff]))
  })

  it('round-trips arbitrary bytes', () => {
    for (const len of [1, 2, 3, 31, 32, 33, 255]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len) & 0xff)
      expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes)
    }
  })

  it('rejects padding, invalid characters, impossible lengths, and nonzero trailing bits', () => {
    expect(b64urlDecode('Zg==')).toBeNull()
    expect(b64urlDecode('Zm9v Yg')).toBeNull()
    expect(b64urlDecode('Zm9+')).toBeNull() // plain-base64 alphabet
    expect(b64urlDecode('Zm9/')).toBeNull()
    expect(b64urlDecode('Zm9vY')).toBeNull() // length % 4 === 1
    expect(b64urlDecode('Zh')).toBeNull() // trailing bits nonzero
    expect(b64urlDecode('Zm9vYh')).toBeNull()
    expect(b64urlDecode('é')).toBeNull()
  })
})

describe('bytesEqual', () => {
  it('compares content, not identity', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })
})

describe('exact-record helpers', () => {
  it('isRecord admits only plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('hasExactKeys rejects missing and unknown keys', () => {
    expect(hasExactKeys({ a: 1, b: 2 }, ['a', 'b'])).toBe(true)
    expect(hasExactKeys({ a: 1 }, ['a', 'b'])).toBe(false)
    expect(hasExactKeys({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBe(false)
    expect(hasExactKeys({}, [])).toBe(true)
  })
})
