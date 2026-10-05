import { ens_normalize } from '@adraffy/ens-normalize'
import { HandleError } from '@libid/contracts'
import { describe, expect, it } from 'vitest'
import { ensName, handleLabels } from './index.js'

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

  it('refuses a chain label that is malformed or names a platform', () => {
    expect(() => ensName('x', 'alice', { chain: 'Base' })).toThrow('Not a chain label')
    expect(() => ensName('x', 'alice', { chain: 'github' })).toThrow('Not a chain label')
    expect(() => ensName('x', 'alice', { chain: '' })).toThrow('Not a chain label')
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
  ] as const)('%s %s has no name', (platform, handle) => {
    expect(ensName(platform, handle)).toBeNull()
  })

  it('throws for text that is not a handle', () => {
    expect(() => ensName('github', 'not a handle')).toThrow(HandleError)
  })
})

describe('handleLabels', () => {
  it('takes the normalized handle and returns the labels before the platform', () => {
    expect(handleLabels('google', 'alice.smith@gmail.com')).toEqual(['alice', 'smith'])
    expect(handleLabels('x', 'ab__cd')).toBeNull()
  })

  it('has no labels when one would pass the 63-byte DNS limit', () => {
    expect(handleLabels('google', `${'a'.repeat(64)}@company.com`)).toBeNull()
    expect(handleLabels('google', `${'a'.repeat(63)}@company.com`)).not.toBeNull()
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
  ] as const)('%s %s gives an already normalized name', (platform, handle) => {
    const name = ensName(platform, handle)
    expect(name).not.toBeNull()
    expect(ens_normalize(name!)).toBe(name)
  })

  it('refuses the X form the transform refuses', () => {
    expect(() => ens_normalize('ab--cd.x.handles.link')).toThrow()
  })
})
