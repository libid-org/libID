export type ReleaseFiles = Record<string, Buffer>

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const packageDir = fileURLToPath(new URL('../', import.meta.url))
export const cache = join(packageDir, '.cache')
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const base = 'https://github.com/libid-org/libid-circuits/releases/download/v0.3.0/'
export async function download(name: string, expected: string) {
  mkdirSync(cache, { recursive: true })
  const path = join(cache, name)
  if (existsSync(path) && hash(readFileSync(path)) === expected) return readFileSync(path)
  const response = await fetch(base + name)
  if (!response.ok) throw new Error('Release download failed')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (hash(bytes) !== expected) throw new Error('Release hash mismatch')
  writeFileSync(path, bytes)
  return bytes
}
export async function circuitRelease(name: string): Promise<ReleaseFiles> {
  const manifest: {
    toolchain: { nargo: string; bb: string }
    tarballs: Record<string, { sha256: string; files: Record<string, string> }>
  } = JSON.parse(
    (
      await download(
        'manifest.json',
        'ac57707b323e507848916b723073bce319df6cb09115c86fea5b6eb2c13e1ab9',
      )
    ).toString('utf8'),
  )
  const dependencies = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  ).dependencies
  for (const name of ['@noir-lang/acvm_js', '@noir-lang/noirc_abi', '@noir-lang/noir_js'])
    if (dependencies[name] !== manifest.toolchain.nargo)
      throw new Error('Noir toolchain/release mismatch')
  if (dependencies['@aztec/bb.js'] !== manifest.toolchain.bb)
    throw new Error('bb.js toolchain/release mismatch')
  const archive = `libid-circuits-0.3.0-${name.replace('_', '-')}.tar.gz`,
    record = manifest.tarballs[archive]
  await download(archive, record.sha256)
  const members = execFileSync('tar', ['-tzf', join(cache, archive)], { encoding: 'utf8' })
    .trim()
    .split('\n')
  const files: ReleaseFiles = {}
  for (const [file, expected] of Object.entries(record.files)) {
    const matches = members.filter((p) => p === file || p.endsWith(`/${file}`))
    if (matches.length !== 1) throw new Error('Ambiguous release member')
    const bytes = execFileSync('tar', ['-xOzf', join(cache, archive), matches[0]], {
      maxBuffer: 32 * 1024 * 1024,
    })
    if (hash(bytes) !== expected) throw new Error('Circuit member hash mismatch')
    files[file] = bytes
  }
  return files
}
