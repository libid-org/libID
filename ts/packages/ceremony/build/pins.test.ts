import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// SWS runs from one image digest in three files; CI fetches the native binary of the same
// release by version for the distribution tests. Each digest carries its tag in a comment.
const repo = new URL('../../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, repo), 'utf8')
const images = [
  'ts/packages/ceremony/ccdp.Dockerfile',
  'ts/packages/ceremony/e2e/compose.yaml',
  'ts/apps/dev/compose.yaml',
]

test('every SWS pin names the same image digest and release', () => {
  const version = /^\s*SWS_VERSION: v(\S+)$/m.exec(read('.github/workflows/ccdp-image.yml'))?.[1]
  assert.ok(version, 'ccdp-image.yml sets SWS_VERSION')
  const digests = new Set<string>()
  for (const path of images) {
    const source = read(path)
    const pinned = [...source.matchAll(/static-web-server@(sha256:[0-9a-f]{64})/g)]
    const tags = [...source.matchAll(/static-web-server:(\S+)/g)]
    assert.ok(pinned.length > 0, `${path} pins SWS by digest`)
    assert.equal(tags.length, pinned.length, `${path} names the tag of each SWS digest`)
    for (const [, digest] of pinned) digests.add(digest)
    // The -alpine variant: the compose healthchecks run its wget.
    for (const [, tag] of tags) assert.equal(tag, `${version}-alpine`, path)
  }
  assert.equal(digests.size, 1, `one SWS digest across ${images.join(', ')}`)
})
