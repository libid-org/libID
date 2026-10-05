import { ens_normalize } from '@adraffy/ens-normalize'
import { HandleError, RULES_GOOGLE, RULES_X } from '@libid/contracts'
import { describe, expect, it } from 'vitest'
import { ensName } from './index.js'

describe('ensName', () => {
  it.each([
    ['github', 'octocat', 'octocat.github.handles.link'],
    ['github', '@OctoCat', 'octocat.github.handles.link'],
    ['github', 'a-b-c', 'a-b-c.github.handles.link'],
    ['x', 'some_handle', 'some-handle.x.handles.link'],
    ['x', '@Some_Handle', 'some-handle.x.handles.link'],
    ['x', 'a__b', 'a--b.x.handles.link'],
    ['x', '_lead', '-lead.x.handles.link'],
    ['google', 'alice@gmail.com', 'alice.google.handles.link'],
    ['google', 'Alice.Smith@Gmail.com', 'alice.smith.google.handles.link'],
    ['google', 'alice@company.com', 'alice._at.company.com.google.handles.link'],
    ['google', 'a.b@c.com', 'a.b._at.c.com.google.handles.link'],
    ['google', 'a@b.c.com', 'a._at.b.c.com.google.handles.link'],
    ['google', 'first-last@my-co.io', 'first-last._at.my-co.io.google.handles.link'],
  ] as const)('%s %s → %s', (platform, handle, name) => {
    expect(ensName(platform, handle)).toBe(name)
  })

  it('adds a chain label before the parent name', () => {
    expect(ensName('x', 'alice', { chain: 'base' })).toBe('alice.x.base.handles.link')
  })

  it('puts the name under the parent a deployment answers under', () => {
    expect(ensName('x', 'alice', { parent: 'testnet.handles.link' })).toBe(
      'alice.x.testnet.handles.link',
    )
    expect(ensName('x', 'alice', { chain: 'base', parent: 'testnet.handles.link' })).toBe(
      'alice.x.base.testnet.handles.link',
    )
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

  it.each([
    // ENSIP-15 reserves `--` at the third and fourth characters.
    ['x', 'ab__cd'],
    // Gmail issues no `+`, `-` or `_`, and a `+tag` is never a canonical address.
    ['google', 'alice+tag@gmail.com'],
    ['google', 'alice_b@gmail.com'],
    ['google', 'alice-b@gmail.com'],
    // An underscore has no label form outside X.
    ['google', 'alice_b@company.com'],
    ['google', 'alice+b@company.com'],
    // `_at` separates a Workspace local part from its domain and is never a piece.
    ['google', 'alice._at@company.com'],
    ['google', 'alice@_at.company.com'],
    // An empty piece is not a label.
    ['google', 'alice..b@company.com'],
    ['google', 'alice@company..com'],
    // ENSIP-15 reserves `--` at the third and fourth characters, IDN domains included.
    ['google', 'ab--cd@company.com'],
    ['google', 'alice@xn--bcher-kva.example'],
  ] as const)('%s %s has no name', (platform, handle) => {
    expect(ensName(platform, handle)).toBeNull()
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
// @adraffy/ens-normalize. A name it changes or refuses is one no wallet resolves.
describe('ENSIP-15', () => {
  it.each([
    ['github', 'octocat'],
    ['x', 'a__b'],
    ['x', '_lead'],
    ['x', 'trail_'],
    ['google', 'alice.smith@gmail.com'],
    ['google', 'first-last@my-co.io'],
    ['google', 'a.b@c.com'],
  ] as const)('%s %s gives an already normalized name', (platform, handle) => {
    const name = ensName(platform, handle)
    expect(name).not.toBeNull()
    expect(ens_normalize(name!)).toBe(name)
  })

  it.each([
    'ab--cd.x.handles.link',
    'ab--cd._at.company.com.google.handles.link',
    'alice._at.xn--bcher-kva.example.google.handles.link',
  ])('refuses %s, a form the transform refuses', (name) => {
    expect(() => ens_normalize(name)).toThrow()
  })
})
