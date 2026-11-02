import { PLATFORM_GITHUB, PLATFORM_X } from '@libid/contracts/platforms'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import {
  bearerLinkPublicInputs,
  buildBearerLinkInputs,
  isBearerLinkPublicInputs,
} from './inputs.js'
import { MAX_HANDLE_BYTES, MAX_ID_BYTES } from './parameters.js'

const encoder = new TextEncoder()

/** An opening of `value` under a blinder of `byte`s. */
const opening = (value: string, byte: number) => {
  const blinder = new Uint8Array(16).fill(byte)
  return { blinder, hash: sha256(concatBytes(encoder.encode(value), blinder)) }
}

const witness = (bearer: string, id = '2244994945', handle = 'Al_1') => ({
  bearer,
  token: opening(bearer, 0),
  identity: opening(bearer, 1),
  id: { value: id, opening: opening(id, 2) },
  handle: { value: handle, opening: opening(handle, 3) },
})

it.each(['', 'a'.repeat(129), 'a'.repeat(4097), 'bad\n', 'a b', 'a\tb', 'é'])(
  'rejects bearers an HTTP Authorization header cannot carry %j [TEST-PLAT-10]',
  (bearer) => {
    expect(() => buildBearerLinkInputs(PLATFORM_X, witness(bearer))).toThrow(/bearer/i)
  },
)

describe('bearer_link public inputs [REQ-PLAT-32B]', () => {
  // libid-circuits v0.8.0 bearer-link's X case: its id and handle, nodes and packed tags.
  it('places the commitments, nodes and tags in circuit order', () => {
    const inputs = buildBearerLinkInputs(PLATFORM_X, witness('tok-123'))
    const fields = bearerLinkPublicInputs(inputs)
    expect(fields).toHaveLength(16)
    expect(fields.slice(8, 12)).toEqual(
      [
        '138453090876486342079439112189991629410',
        '68569463062552354167696804669992816532',
        '169904273960443994800052718057341968900',
        '182742246427322026301030621552550382480',
      ].map((n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`),
    )
    const tag = (text: string) =>
      `0x${Buffer.from(text).toString('hex').padEnd(62, '0').padStart(64, '0')}`
    expect(fields.slice(12)).toEqual([
      tag('libid.x.user-id'),
      `0x${(15).toString(16).padStart(64, '0')}`,
      tag('libid.x.handle'),
      `0x${(14).toString(16).padStart(64, '0')}`,
    ])
    expect(isBearerLinkPublicInputs(fields, inputs)).toBe(true)
    expect(isBearerLinkPublicInputs([...fields].reverse(), inputs)).toBe(false)
  })

  it('pads the id and the handle to their buffers and refuses longer ones', () => {
    const inputs = buildBearerLinkInputs(PLATFORM_GITHUB, witness('gho_tok', '583231', 'Octo-Cat'))
    expect(inputs.id).toHaveLength(20)
    expect(inputs.handle).toHaveLength(39)
    expect(inputs.handle_len).toBe('8')
    expect(() =>
      buildBearerLinkInputs(PLATFORM_GITHUB, witness('gho_tok', '583231', 'a'.repeat(40))),
    ).toThrow()
    expect(() =>
      buildBearerLinkInputs(PLATFORM_GITHUB, witness('gho_tok', '1'.repeat(21), 'octocat')),
    ).toThrow()
  })

  it('has the id and handle buffers of every platform it proves', () => {
    for (const platform of [PLATFORM_X, PLATFORM_GITHUB]) {
      expect(platform.idRules.maxLength).toBe(MAX_ID_BYTES)
      expect(platform.rules.maxLength).toBe(MAX_HANDLE_BYTES)
    }
  })
})
