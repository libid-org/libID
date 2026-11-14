import { normalize as ensNormalize } from 'viem/ens'
import { describe, expect, it } from 'vitest'
import { ensName, HandleError } from './index.js'

describe('ensName', () => {
  // The normalized forms are in vectors/names.json; these fold A-Z first.
  it.each([
    ['github', 'OctoCat', 'octocat.github.handles.link'],
    ['x', 'Some_Handle', 'some-handle.x.handles.link'],
    ['google', 'Alice.Smith@Gmail.com', 'alice.smith.google.handles.link'],
    ['google', 'Alice@Company.com', 'alice._at.company.com.google.handles.link'],
  ] as const)('folds %s %j first: %s', (platform, handle, name) => {
    expect(ensName(platform, handle)).toBe(name)
  })

  // The contracts' rules fold A-Z and strip nothing; `@` and spaces are not
  // ENSIP-15 label characters, so such text has no name.
  it.each([
    ['github', '@OctoCat'],
    ['x', '@Some_Handle'],
    ['x', '  alice '],
  ] as const)('gives %s %j no name', (platform, handle) => {
    expect(() => ensNormalize(handle.toLowerCase())).toThrow('disallowed character')
    expect(ensName(platform, handle)).toBeNull()
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

  it('takes a parent label of 63 bytes', () => {
    const parent = `${'a'.repeat(63)}.link`
    expect(ensName('x', 'alice', { parent })).toBe(`alice.x.${parent}`)
  })

  it('reads null options as none', () => {
    expect(ensName('x', 'alice', null)).toBe('alice.x.handles.link')
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

  it.each([
    ['github', '', 'Empty'],
    ['x', 'ali"ce', 'BadCharacter'],
    ['x', 'ali\\ce', 'BadCharacter'],
    ['x', 'alicé', 'BadCharacter'],
    ['github', 'a'.repeat(40), 'TooLong'],
  ] as const)('throws HandleError for %s %j: %s', (platform, handle, kind) => {
    expect(() => ensName(platform, handle)).toThrow(HandleError)
    expect(() => ensName(platform, handle)).toThrow(expect.objectContaining({ kind }))
  })

  it('throws for a platform it does not know or a handle that is not a string', () => {
    expect(() => ensName('mastodon' as 'x', 'alice')).toThrow('Not a platform')
    expect(() => ensName('github', null as unknown as string)).toThrow(TypeError)
  })
})
