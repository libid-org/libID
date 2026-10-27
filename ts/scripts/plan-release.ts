import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import semver from 'semver'
import { packages } from './packages.ts'

// Plans the publication of the tarballs check-packages.ts packed. For each package whose version
// is not on npm, in publication order, prints `<tarball> <name> <version> <dist-tag>`. Every
// `@libid/*` dependency of a planned package must be on npm or planned before it.
const { values } = parseArgs({ options: { prerelease: { type: 'boolean', default: false } } })
const output = fileURLToPath(new URL('../.cache/npm', import.meta.url))

// The versions on npm, plus the ones planned so far.
const available = new Map<string, string[]>()
const versionsOf = (name: string): string[] => {
  let versions = available.get(name)
  if (!versions) {
    versions = JSON.parse(
      execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' }),
    )
    available.set(name, versions)
  }
  return versions
}

const plan: string[] = []
for (const directory of packages) {
  const tarball = `${directory}.tgz`
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOzf', join(output, tarball), 'package/package.json'], {
      encoding: 'utf8',
    }),
  )
  const { name, version } = manifest
  if (versionsOf(name).includes(version)) {
    console.error(`${name}@${version} is on npm`)
    continue
  }
  const requires = Object.entries<string>({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })
  for (const [dependency, range] of requires) {
    if (!dependency.startsWith('@libid/')) continue
    assert(
      semver.maxSatisfying(versionsOf(dependency), range),
      `${name}@${version} requires ${dependency}@${range}, which is neither on npm nor published before it`,
    )
  }
  versionsOf(name).push(version)
  const distTag = values.prerelease || semver.prerelease(version) ? 'next' : 'latest'
  plan.push(`${tarball} ${name} ${version} ${distTag}`)
}
assert(plan.length > 0, 'every package version is already on npm; bump a version to release')
console.log(plan.join('\n'))
