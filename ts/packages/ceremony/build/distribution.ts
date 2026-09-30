import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Rollup } from 'vite'
import type { AssetRequest, ExternalAsset } from '../src/assets/index.ts'
import { assetKey, requestKey } from '../src/assets/keys.ts'
import { messages } from '../src/ccdp/uiMessages.ts'
import { safePath } from './archive.ts'
import type { AssetManifest } from './assetPlugin.ts'
import type { ResolvedAssets } from './assets.ts'
import { assetHeaders, externalRequest, mediaType, resolveAssets } from './assets.ts'
import type { BundleNode } from './bundle.ts'
import { bundle, workerUrl } from './bundle.ts'
import { captureInput } from './input.ts'
import type { ResponseProfile } from './profiles.ts'
import { responseHeaders } from './profiles.ts'
import { outputDirectory, packageDir } from './sources.ts'
import { errorHeaders, writeDistribution } from './sws.ts'
import { catalogVersions, proverPair, publishableVersions } from './versions.ts'

export type DistributionMetadata = AssetManifest & {
  headers: Record<string, Record<string, string>>
  graph: Record<string, BundleNode>
  files: Record<string, string>
}

type PublicRecord = { bytes: Buffer; headers: Record<string, string> }

type Records = Map<string, PublicRecord>

const index = process.argv.indexOf('--out-dir'),
  out = outputDirectory(index < 0 ? join(packageDir, 'dist-artifacts') : process.argv[index + 1])

const staging = `${out}.building`

if (existsSync(staging)) throw new Error('Build staging directory already exists')

/** One request per exact URL and Range, first occurrence first. */
const unique = (requests: AssetRequest[]) => [
  ...new Map(requests.map((r) => [requestKey(r), r])).values(),
]

/** Same bytes and the same normalized headers. */
const sameRecord = (a: PublicRecord, b: PublicRecord) =>
  a.bytes.equals(b.bytes) && JSON.stringify(a.headers) === JSON.stringify(b.headers)

const body = (item: Rollup.OutputChunk | Rollup.OutputAsset) =>
  item.type === 'chunk' ? item.code : item.source

/** Inline code cannot end its script element early. */
const inlineScript = (code: string) => code.replace(/<\/script/gi, '<\\/script')

const page = (title: string, content: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body>${content}</body></html>`

/**
 * Each profile's declared assets and its platform entry's emitted closure, then the allowlist.
 * The closure stops at other platforms' provers: the prover table reaches every one of them
 * lazily, but a run loads only its own.
 */
function assetManifest(
  data: ResolvedAssets,
  graph: ReadonlyMap<string, BundleNode>,
  entries: ReadonlyMap<string, string>,
  records: Records,
  external: readonly ExternalAsset[],
): AssetManifest {
  const closure = (profile: string, file: string, set = new Set<string>()): Set<string> => {
    const pair = proverPair(graph.get(file)?.entry ?? null)
    if (set.has(file) || (pair !== undefined && pair !== profile)) return set
    set.add(file)
    for (const next of graph.get(file)?.dependencies ?? [])
      closure(profile, next.replace(/^\//, ''), set)
    return set
  }
  const local = (url: string): AssetRequest => {
    const record = records.get(url)
    if (!record) throw new Error(`Unindexed dependency: ${url}`)
    return { url, bytes: record.bytes.length, mime: record.headers['content-type'].split(';')[0] }
  }
  const requestsByProfile: Record<string, AssetRequest[]> = {}
  for (const [profile, assets] of Object.entries(data.profiles)) {
    const entry = entries.get(profile)
    if (!entry) throw new Error(`Missing emitted platform entry: ${profile}`)
    requestsByProfile[profile] = unique([
      ...assets.map((a) => (a.isExternal ? externalRequest(a) : local(data.urls[assetKey(a)]))),
      ...[...closure(profile, entry)].map((file) => local(`/${file}`)),
    ])
  }
  const allowedRequests = unique([
    ...Object.values(requestsByProfile).flat(),
    ...external.flatMap((a) => (a.fallback ?? []).map((url) => ({ ...externalRequest(a), url }))),
  ])
  return { requestsByProfile, allowedRequests }
}

/** Resolve assets, bundle the documents and record every public resource with its policy. */
async function buildDistribution() {
  const data = await resolveAssets(),
    records: Records = new Map()
  const external = Object.values(data.profiles)
    .flat()
    .filter((a) => a.isExternal === true)
  const options = {
    externalOrigins: [
      ...new Set(
        external.flatMap((a) => [a.source, ...(a.fallback ?? [])].map((u) => new URL(u).origin)),
      ),
    ],
  }
  // Header names are normalized once, to the lowercase `Headers` form, so records compare directly.
  const put = (
    path: string,
    content: string | Uint8Array,
    policy: ResponseProfile | Record<string, string>,
  ) => {
    const headers = new Headers(
      typeof policy === 'string' ? responseHeaders(policy, options) : policy,
    )
    if (policy === 'asset') headers.set('Content-Type', mediaType(path))
    const record = { bytes: Buffer.from(content), headers: Object.fromEntries(headers) },
      old = records.get(path)
    if (old && !sameRecord(old, record)) throw new Error(`Conflicting output: ${path}`)
    records.set(path, record)
  }
  const emitDocument = (path: string, code: string, profile: ResponseProfile) => {
    const scripts = [captureInput(path), code].map(inlineScript)
    put(
      path,
      page(
        messages.brand,
        `<main id="libid-root"></main><script>${scripts[0]}</script><script type="module">${scripts[1]}</script>`,
      ),
      responseHeaders(profile, { ...options, inline: scripts }),
    )
  }
  for (const [path, record] of data.local) put(path, record.bytes, record.headers)
  const prover = await bundle('src/ccdp/documents/prover.ts', data, {
    invoke: 'startProver',
    input: true,
  })
  // Every prover the Prover can load is its own emitted chunk; the published set comes from them.
  const proverEntries = new Map<string, string>()
  for (const [file, node] of prover.graph) {
    const pair = proverPair(node.entry)
    if (pair) proverEntries.set(pair, file)
  }
  const versions = publishableVersions(
    await catalogVersions(),
    proverEntries.keys(),
    Object.keys(data.profiles),
  )
  const workerProfile = (file: string): ResponseProfile => {
    const modules = prover.graph.get(file)?.modules ?? []
    if (modules.some((m) => m.endsWith('/notary/session.worker.ts'))) return 'notaryWorker'
    return modules.some((m) => m.endsWith(workerUrl)) ? 'proofWorker' : 'leafWorker'
  }
  for (const item of prover.output) {
    if (item.type !== 'chunk' || !item.isEntry)
      put(
        `/${item.fileName}`,
        body(item),
        prover.workerFiles.has(item.fileName) && item.fileName.endsWith('.js')
          ? workerProfile(item.fileName)
          : 'asset',
      )
  }
  const manifest = assetManifest(data, prover.graph, proverEntries, records, external)
  // Every published pair has an emitted prover and asset profile.
  put('/ccdp/versions.json', JSON.stringify(versions), 'versions')
  const primary = prover.output.find(
    (o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry,
  )
  if (!primary) throw new Error('Missing Prover entry')
  emitDocument('/ccdp/v1/prover', primary.code, 'prover')
  emitDocument('/ccdp/v1/prover/fallback', primary.code, 'proverFallback')
  const callback = await bundle('src/ccdp/documents/callback.ts', data, {
    selfContained: true,
    invoke: 'startCallback',
  })
  for (const item of callback.output) {
    if (item.type !== 'chunk' || !item.isEntry) throw new Error('Callback must be self-contained')
    if (item.imports.length || item.dynamicImports.length || item.referencedFiles.length)
      throw new Error('Callback must have no external dependencies')
    const code = inlineScript(item.code)
    put(
      '/ccdp/callback.html',
      page(
        messages.brand,
        `<main id="libid-root"></main><script id="libid-callback-config" type="application/json">__LIBID_CALLBACK_CONFIG__</script><script type="module">${code}</script>`,
      ),
      responseHeaders('callback', { ...options, inline: [code] }),
    )
  }
  const prefetch = await bundle('src/ccdp/documents/prefetch.ts', data, {
    invoke: 'startPrefetch',
    input: true,
    manifest,
  })
  for (const item of prefetch.output) {
    if (item.type === 'chunk' && item.isEntry) {
      emitDocument('/ccdp/v1/prefetch', item.code, 'prefetch')
      put('/ccdp/v1/worker.js', item.code, 'worker')
    } else put(`/${item.fileName}`, body(item), 'asset')
  }
  // The page every 404 serves; requested directly it declares the same error policy.
  put('/404.html', page(messages.notFoundTitle, `<p>${messages.notFound}</p>`), {
    'Content-Type': 'text/html; charset=utf-8',
    ...errorHeaders,
  })
  return { records, manifest, graph: prover.graph }
}

/** Retain old immutable assets and their effective policy through the compatibility window. */
function retainPrevious(records: Records) {
  const previousGraph = join(out, 'distribution-graph.json')
  if (!existsSync(previousGraph)) return
  const previous: DistributionMetadata = JSON.parse(readFileSync(previousGraph, 'utf8'))
  for (const [path, headers] of Object.entries(previous.headers)) {
    if (!path.startsWith('/ccdp/assets/')) continue
    safePath(path.slice(1))
    assetHeaders(path, headers)
    const record = {
        bytes: readFileSync(join(out, 'public', path)),
        headers: Object.fromEntries(new Headers(headers)),
      },
      current = records.get(path)
    if (!current) records.set(path, record)
    else if (!sameRecord(current, record)) throw new Error(`Immutable response changed: ${path}`)
  }
}

/** Replace the output with the finished staging directory, restoring it if the move fails. */
function swapInto(target: string) {
  if (!existsSync(target)) return renameSync(staging, target)
  const previous = `${target}.previous`
  if (existsSync(previous)) throw new Error('Previous output already exists')
  renameSync(target, previous)
  try {
    renameSync(staging, target)
  } catch (error) {
    renameSync(previous, target)
    throw error
  }
  rmSync(previous, { recursive: true })
}

mkdirSync(join(staging, 'public'), { recursive: true })

try {
  const { records, manifest, graph } = await buildDistribution()
  retainPrevious(records)
  const files = writeDistribution(staging, records)
  // Keep graph metadata outside public/; the image retains it for subsequent builds.
  writeFileSync(
    join(staging, 'distribution-graph.json'),
    JSON.stringify({
      files,
      ...manifest,
      headers: Object.fromEntries([...records].map(([p, r]) => [p, r.headers])),
      graph: Object.fromEntries(graph),
    } satisfies DistributionMetadata),
  )
  swapInto(out)
  console.log(`Built ${records.size} public resources in ${out}`)
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  throw error
}
