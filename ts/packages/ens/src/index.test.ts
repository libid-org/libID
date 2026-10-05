import { ens_normalize } from '@adraffy/ens-normalize'
import { RULES_GOOGLE, RULES_X } from '@libid/contracts/identity'
import { describe, expect, it } from 'vitest'
import { ensName, HandleError } from './index.js'

describe('ensName', () => {
  // The normalized forms are in vectors/names.json; these are raw inputs.
  it.each([
    ['github', '@OctoCat', 'octocat.github.handles.link'],
    ['x', '@Some_Handle', 'some-handle.x.handles.link'],
    ['x', '  alice ', 'alice.x.handles.link'],
    ['google', 'Alice.Smith@Gmail.com', 'alice.smith.google.handles.link'],
    ['google', 'Alice@Company.com', 'alice._at.company.com.google.handles.link'],
  ] as const)('normalizes %s %j first: %s', (platform, handle, name) => {
    expect(ensName(platform, handle)).toBe(name)
  })

  it.each([
    '',
    'handles..link',
    '.handles.link',
    'Handles.link',
    'ab--cd.link',
    `${'a'.repeat(64)}.link`,
    null,
  ])('refuses the parent name %j', (parent) => {
    expect(() => ensName('x', 'alice', { parent: parent as string })).toThrow('Not a parent name')
  })

  it('normalizes with the rules it is given', () => {
    expect(() => ensName('x', 'alice', { rules: { ...RULES_X, maxLength: 4 } })).toThrow(
      HandleError,
    )
  })

  // A Google address is at most 62 bytes under the released rules, so only a
  // chain whose owner raised the limit can produce a piece past 63.
  it('gives no name when a piece would pass the 63-byte DNS limit', () => {
    const rules = { ...RULES_GOOGLE, maxLength: 200 }
    expect(ensName('google', `${'a'.repeat(64)}@company.com`, { rules })).toBeNull()
    expect(ensName('google', `${'a'.repeat(63)}@company.com`, { rules })).toBe(
      `${'a'.repeat(63)}._at.company.com.google.handles.link`,
    )
  })

  it.each([
    ['uppercase', 'Base'],
    ['a platform key', 'github'],
    ['empty', ''],
    ['an underscore', 'op_mainnet'],
    ['a dot', 'op.mainnet'],
    ['ENSIP-15 reserved `--`', 'ab--cd'],
    ['past 63 bytes', 'a'.repeat(64)],
    ['not a string', null],
  ])('refuses a chain label that is %s', (_, chain) => {
    expect(() => ensName('x', 'alice', { chain: chain as string })).toThrow('Not a chain label')
  })

  it('takes a chain label of 63 bytes', () => {
    const chain = 'a'.repeat(63)
    expect(ensName('x', 'alice', { chain })).toBe(`alice.x.${chain}.handles.link`)
  })

  it('throws for text that is not a handle', () => {
    expect(() => ensName('github', 'not a handle')).toThrow(HandleError)
  })

  it('throws for a platform it does not know or a handle that is not a string', () => {
    expect(() => ensName('mastodon' as 'x', 'alice')).toThrow('Not a platform')
    expect(() => ensName('github', null as unknown as string)).toThrow(TypeError)
  })
})

// ENSIP-15 is what every wallet applies before hashing, through
// @adraffy/ens-normalize. The vector test checks every name is normal; these
// are the forms the transform refuses because ENSIP-15 does.
describe('ENSIP-15', () => {
  it.each([
    'ab--cd.x.handles.link',
    'ab--cd._at.company.com.google.handles.link',
    'alice._at.xn--bcher-kva.example.google.handles.link',
  ])('refuses %s, a form the transform refuses', (name) => {
    expect(() => ens_normalize(name)).toThrow()
  })
})
