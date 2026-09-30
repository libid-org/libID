import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Header } from 'tar'
import { readArchive, safePath, selectMember } from './archive.ts'
import { cache, packageDir } from './sources.ts'

function tar(entries: { path: string; type?: 'File' | 'SymbolicLink' | 'Link'; body?: string }[]) {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '')
    const header = new Header({
      path: entry.path,
      type: entry.type ?? 'File',
      size: body.length,
      mode: 0o644,
      linkpath: entry.type ? '../../outside' : undefined,
    })
    header.encode()
    chunks.push(header.block!, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

test('safe archives preserve paths and wildcard selectors select exactly once [LIBID-ASSET-024] [LIBID-ASSET-025]', async () => {
  mkdirSync(cache, { recursive: true })
  const dir = mkdtempSync(join(cache, 'archive-test-')),
    path = join(dir, 'bundle.tar.gz')
  try {
    writeFileSync(
      path,
      tar([
        { path: './module.js', body: 'import "./snippets/web-spawn-ab/js/spawn.js"' },
        { path: 'snippets/web-spawn-ab/js/spawn.js', body: 'export {}' },
        { path: 'unselected.json', body: '{}' },
      ]),
    )
    const files = await readArchive(path)
    assert.equal(files.size, 3)
    assert.deepEqual(await readArchive(relative(packageDir, path)), files)
    assert.equal(
      selectMember(files, 'snippets/web-spawn-*/js/spawn.js'),
      'snippets/web-spawn-ab/js/spawn.js',
    )
    assert.throws(() => selectMember(files, 'snippets/*/spawn.js'), /exactly once/)
    files.set('snippets/web-spawn-cd/js/spawn.js', Buffer.from(''))
    assert.throws(() => selectMember(files, 'snippets/web-spawn-*/js/spawn.js'), /exactly once/)
    for (const entries of [
      [{ path: '../escape' }],
      [{ path: '/absolute' }],
      [{ path: 'a', type: 'Link' as const }],
      [{ path: 'a', type: 'SymbolicLink' as const }],
      [{ path: 'a' }, { path: 'a' }],
      [{ path: 'a' }, { path: 'a/b' }],
    ]) {
      writeFileSync(path, tar(entries))
      await assert.rejects(readArchive(path))
    }
    for (const path of [
      '../a',
      '/a',
      'a/../b',
      'a?b',
      'a%2fb',
      'a\\b',
      'a//b',
      '[a].js',
      '{a,b}.js',
    ])
      assert.throws(() => safePath(path))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
