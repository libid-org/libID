import { join } from 'node:path'
import { resolveAssets, mediaType } from '../build/assets.ts'
import { bundle } from '../build/bundle.ts'
import { responseHeaders } from '../build/profiles.ts'
import { packageDir } from '../build/release.ts'
import { writeDistribution } from '../build/sws.ts'

const data = await resolveAssets()
const emitted = await bundle('e2e/smoke.ts', data, { groupModules: false })
const records = new Map(data.local)
const options = {}
for (const item of emitted.output) {
  const path = `/${item.fileName}`
  const policy = emitted.workerFiles.has(item.fileName) ? 'executionWorker' : 'asset'
  records.set(path, {
    bytes: Buffer.from(item.type === 'chunk' ? item.code : item.source),
    headers: { ...responseHeaders(policy, options), 'Content-Type': mediaType(path) },
  })
}
const entry = emitted.output.find((item) => item.type === 'chunk' && item.isEntry)
if (!entry) throw new Error('Missing smoke entry')
records.set('/index.html', {
  bytes: Buffer.from(
    `<!doctype html><title>Ceremony engine qualification</title><script type="module" src="/${entry.fileName}"></script>`,
  ),
  headers: responseHeaders('proverFallback', options),
})
writeDistribution(join(packageDir, '.cache/smoke'), records)
