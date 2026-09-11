import { expect, it } from 'vitest'
import { buildBearerLinkWitness, validateBearerLinkPublicInputs } from './inputs.js'

it('matches token then identity commitments exactly [LIBID-PROVER-001]', () => {
  const opening = (byte: number) => ({
    start: 0,
    end: 3,
    blinder: new Uint8Array(16).fill(byte),
    hash: new Uint8Array(32).fill(byte),
  })
  const inputs = buildBearerLinkWitness('abc', opening(1), opening(2))
  const token = new Array<string>(32).fill(`0x${'0'.repeat(63)}1`)
  const identity = new Array<string>(32).fill(`0x${'0'.repeat(63)}2`)
  const expected = [...token, ...identity]
  expect(validateBearerLinkPublicInputs(expected, inputs)).toBe(true)
  for (const value of [
    expected.slice(1),
    [...expected, expected[0]],
    [...identity, ...token],
    [...expected.slice(0, -1), token[0]],
  ])
    expect(validateBearerLinkPublicInputs(value, inputs)).toBe(false)
})
