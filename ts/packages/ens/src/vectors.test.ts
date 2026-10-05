// The vector table for the transform and its inverse. The gateway's inverse
// does not read this file yet; the inverse here is this package's own, written
// from REQ-ENS-LABEL-05 and REQ-ENS-NAME-02 apart from the transform it reverses.
import { readFileSync } from 'node:fs'
import {
  normalize,
  PLATFORM_GITHUB_KEY,
  PLATFORM_GOOGLE_KEY,
  PLATFORM_X_KEY,
  rulesFor,
} from '@libid/contracts/identity'
import { normalize as ensNormalize } from 'viem/ens'
import { describe, expect, it } from 'vitest'
import { ensName, type Platform } from './index.js'

interface Vectors {
  parent: string
  names: {
    platform: Platform
    handle: string
    chain: string | null
    parent?: string
    name: string
  }[]
  unnamed: { platform: Platform; handle: string; why: string }[]
  nonNames: { name: string; why: string }[]
}

const vectors: Vectors = JSON.parse(
  readFileSync(new URL('../vectors/names.json', import.meta.url), 'utf8'),
)

describe('names', () => {
  it.each(vectors.names)('$platform $handle → $name', (v) => {
    const options = { parent: v.parent ?? vectors.parent, ...(v.chain ? { chain: v.chain } : {}) }
    expect(ensName(v.platform, v.handle, options)).toBe(v.name)
  })

  it.each(vectors.names)('$name reads back as $platform $handle', (v) => {
    expect(handleOf(v.name, v.parent ?? vectors.parent)).toEqual({
      platform: v.platform,
      handle: v.handle,
      chain: v.chain,
    })
  })

  // ENSIP-15 is what every wallet applies before hashing (viem's `normalize`
  // is @adraffy/ens-normalize). A name it changes or refuses is one no wallet
  // resolves.
  it.each(vectors.names)('$name is ENSIP-15 normal', ({ name }) => {
    expect(ensNormalize(name)).toBe(name)
  })

  it('gives distinct handles distinct names', () => {
    const names = vectors.names.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('handles', () => {
  it.each([...vectors.names, ...vectors.unnamed])(
    '$platform $handle is already normalized',
    ({ platform, handle }) => {
      expect(normalize(handle, rulesFor(platform)!)).toBe(handle)
    },
  )
})

describe('unnamed', () => {
  it.each(vectors.unnamed)('$platform $handle has no name: $why', (v) => {
    expect(ensName(v.platform, v.handle)).toBeNull()
  })
})

describe('nonNames', () => {
  it.each(vectors.nonNames)('$name reads back as no handle: $why', (v) => {
    expect(handleOf(v.name, vectors.parent)).toBeNull()
  })
})

const PLATFORMS: readonly string[] = [PLATFORM_GITHUB_KEY, PLATFORM_X_KEY, PLATFORM_GOOGLE_KEY]
const LABEL = /^[a-z0-9-]+$/

/** The handle a name asks about, read right to left, or `null` for none. */
function handleOf(
  name: string,
  parent: string,
): { platform: string; handle: string; chain: string | null } | null {
  if (!name.endsWith(`.${parent}`)) return null
  const labels = name.slice(0, -parent.length - 1).split('.')
  const last = labels.pop()
  if (last === undefined) return null
  let chain: string | null = null
  let platform = last
  if (!PLATFORMS.includes(last)) {
    chain = last
    platform = labels.pop() ?? ''
    if (!PLATFORMS.includes(platform)) return null
  }
  const handle = handleFromLabels(platform, labels)
  if (handle === null) return null
  const rules = rulesFor(platform)
  try {
    if (rules === null || normalize(handle, rules) !== handle) return null
  } catch {
    return null
  }
  return { platform, handle, chain }
}

function handleFromLabels(platform: string, labels: string[]): string | null {
  const wellformed = (part: string[]) => part.length > 0 && part.every((l) => LABEL.test(l))
  if (platform === 'x' || platform === 'github') {
    if (labels.length !== 1 || !wellformed(labels)) return null
    return platform === 'x' ? labels[0]!.replaceAll('-', '_') : labels[0]!
  }
  const at = labels.indexOf('_at')
  if (at >= 0) {
    const local = labels.slice(0, at)
    const domain = labels.slice(at + 1)
    return wellformed(local) && wellformed(domain) ? `${local.join('.')}@${domain.join('.')}` : null
  }
  return labels.length > 0 && labels.every((l) => /^[a-z0-9]+$/.test(l))
    ? `${labels.join('.')}@gmail.com`
    : null
}
