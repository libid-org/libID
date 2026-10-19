import { bytesToHex } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { handleNode, idNode, isAccountId, isHandle } from './identity.js'

const hex = (bytes: Uint8Array) => `0x${bytesToHex(bytes)}`

// The platform-ceremonies §2.1 conformance vectors.
describe('identity nodes [TEST-PLAT-02] [TEST-PLAT-20]', () => {
  it.each([
    [
      'google',
      '110169484474386276334',
      '0x620866cfb4d2776a32cd94d8e8b55577526af86115ebf125d4ca1ca7bf07737e',
    ],
    ['x', '2244994945', '0x68291869976ffad2abf3e933ec9ab2623395ff8b3b9242e655e1da3ef43d4f94'],
    ['github', '583231', '0x475902b27989feb395b9b0cd3156aa573a9676c13155b8e7e3ddaf3e77181847'],
  ])('derives the %s id node of %s, the id unchanged', (platform, id, node) => {
    expect(hex(idNode(platform, id))).toBe(node)
  })

  it.each([
    [
      'google',
      'A.B+tag@Example.COM',
      '0x40169b5cc6400158aeef2a13b73a14fc36e5e1df8595572b8fe282a269f26dd4',
    ],
    ['x', 'Alice_1', '0xe09c4f5bfbbc723bc35701ea9d718a1c5edb29b1ed5bb0cb0fabb3c43d8136af'],
    ['github', 'OctoCat', '0x381fb9d7d3b01214e58b94202ea10f78e169adef68bcc20d40c130deca6dfe74'],
  ])('derives the %s handle node of %s, folded', (platform, handle, node) => {
    expect(hex(handleNode(platform, handle))).toBe(node)
    expect(hex(handleNode(platform, handle.toLowerCase()))).toBe(node)
  })

  it('applies the token check, not a platform alphabet [REQ-PLAT-08A]', () => {
    for (const handle of [' @Alice_1 ', 'a-b', 'a.b', 'Octo--Cat-', 'a'.repeat(39)])
      expect(isHandle('x', handle), handle).toBe(true)
    for (const handle of ['', 'a"b', 'a\\b', 'a\tb', 'é', 'a'.repeat(40)])
      expect(isHandle('x', handle), handle).toBe(false)
    expect(isHandle('google', `${'a'.repeat(50)}@example.com`)).toBe(true)
    expect(isHandle('google', `${'a'.repeat(51)}@example.com`)).toBe(false)
    for (const id of ['0', '0123', '9'.repeat(20)]) expect(isAccountId('github', id), id).toBe(true)
    for (const id of ['', '9'.repeat(21), ' 1', '+1', '1e3', 'x1'])
      expect(isAccountId('x', id), id).toBe(false)
    expect(isAccountId('google', `!${'~'.repeat(30)}`)).toBe(true)
    expect(isAccountId('google', '1'.repeat(32))).toBe(false)
    expect(() => idNode('x', 'x1')).toThrow()
    expect(() => handleNode('x', 'a"b')).toThrow()
  })
})
