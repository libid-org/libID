import { join } from 'node:path'
import { mediaType, resolveAssets } from '../build/assets.ts'
import { bundle } from '../build/bundle.ts'
import { emittedProfile, responseHeaders } from '../build/profiles.ts'
import { packageDir } from '../build/sources.ts'
import { writeDistribution } from '../build/sws.ts'

const data = await resolveAssets()

const emitted = await bundle('e2e/runtime.ts', data, { groupModules: false })

const records = new Map(data.local)

for (const item of emitted.output) {
  const path = `/${item.fileName}`
  // The same classification the Distribution ships, so the runtime page runs production policy.
  const policy = emittedProfile(item.fileName, emitted)
  records.set(path, {
    bytes: Buffer.from(item.type === 'chunk' ? item.code : item.source),
    headers: { ...responseHeaders(policy), 'Content-Type': mediaType(path) },
  })
}

const entry = emitted.output.find((item) => item.type === 'chunk' && item.isEntry)

if (!entry) throw new Error('Missing runtime entry')

records.set('/index.html', {
  bytes: Buffer.from(
    `<!doctype html><title>Ceremony runtime</title><script type="module" src="/${entry.fileName}"></script>`,
  ),
  headers: responseHeaders('proverFallback'),
})

writeDistribution(join(packageDir, '.cache/runtime'), records)
