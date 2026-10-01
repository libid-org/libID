import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Rollup } from 'vite'
import type { AssetRequest, ExternalAsset } from '../src/assets/index.ts'
import { assetKey, CALLBACK_PATH, requestKey, route, VERSIONS_PATH } from '../src/assets/keys.ts'
import { messages } from '../src/ccdp/uiMessages.ts'
import type { AssetManifest } from './assetPlugin.ts'
import type { ResolvedAssets } from './assets.ts'
import { externalRequest, mediaType, resolveAssets } from './assets.ts'
import type { BundleNode } from './bundle.ts'
import { bundle } from './bundle.ts'
import { captureFragment } from './fragment.ts'
import { sameRecord, swapInto } from './output.ts'
import type { ResponseProfile } from './profiles.ts'
import { emittedProfile, responseHeaders } from './profiles.ts'
import { artifactsDir, outputDirectory } from './sources.ts'
import { errorHeaders, type PublicRecord, writeDistribution } from './sws.ts'
import { catalogVersions, proverPair, publishableVersions } from './versions.ts'

export type DistributionMetadata = AssetManifest & {
  headers: Record<string, Record<string, string>>
  graph: Record<string, BundleNode>
  files: Record<string, string>
}

type Records = Map<string, PublicRecord>

/** One request per exact URL and Range, first occurrence first. */
const unique = (requests: AssetRequest[]) => [
  ...new Map(requests.map((r) => [requestKey(r), r])).values(),
]

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
  documentImports: readonly string[],
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
    const files = closure(profile, entry)
    // The Prover document inlines its entry, so everything that entry imports loads first.
    for (const file of documentImports) closure(profile, file, files)
    requestsByProfile[profile] = unique([
      ...assets.map((a) => (a.isExternal ? externalRequest(a) : local(data.urls[assetKey(a)]))),
      ...[...files].map((file) => local(`/${file}`)),
    ])
  }
  const allowedRequests = unique([
    ...Object.values(requestsByProfile).flat(),
    ...external.flatMap((a) => (a.fallback ?? []).map((url) => ({ ...externalRequest(a), url }))),
  ])
  return { requestsByProfile, allowedRequests }
}

/** Every public resource with its policy; a path gets one record, or the same one again. */
class PublicTree {
  readonly records: Records = new Map()
  readonly options: { externalOrigins: string[] }

  constructor(externalOrigins: string[]) {
    this.options = { externalOrigins }
  }

  // Header names are normalized once, to the lowercase `Headers` form, so records compare directly.
  put(
    path: string,
    content: string | Uint8Array,
    policy: ResponseProfile | Record<string, string>,
  ) {
    const headers = new Headers(
      typeof policy === 'string' ? responseHeaders(policy, this.options) : policy,
    )
    if (policy === 'asset') headers.set('Content-Type', mediaType(path))
    const record = { bytes: Buffer.from(content), headers: Object.fromEntries(headers) }
    const old = this.records.get(path)
    if (old && !sameRecord(old, record)) throw new Error(`Conflicting output: ${path}`)
    this.records.set(path, record)
  }

  /** A document inlining the fragment capture and its module entry. */
  document(path: string, code: string, profile: ResponseProfile) {
    const scripts = [captureFragment(path), code].map(inlineScript)
    this.put(
      path,
      page(
        messages.brand,
        `<main id="libid-root"></main><script>${scripts[0]}</script><script type="module">${scripts[1]}</script>`,
      ),
      responseHeaders(profile, { ...this.options, inline: scripts }),
    )
  }
}

/** Resolve assets, bundle the documents and record every public resource with its policy. */
async function buildDistribution() {
  const data = await resolveAssets()
  const external = Object.values(data.profiles)
    .flat()
    .filter((a) => a.isExternal === true)
  const tree = new PublicTree([
    ...new Set(
      external.flatMap((a) => [a.source, ...(a.fallback ?? [])].map((u) => new URL(u).origin)),
    ),
  ])
  const { records, options } = tree
  for (const [path, record] of data.local) tree.put(path, record.bytes, record.headers)
  const prover = await bundle('src/ccdp/documents/prover.ts', data, {
    invoke: 'startProver',
    fragment: true,
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
  for (const item of prover.output) {
    if (item.type !== 'chunk' || !item.isEntry)
      tree.put(`/${item.fileName}`, body(item), emittedProfile(item.fileName, prover))
  }
  const primary = prover.output.find(
    (o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry,
  )
  if (!primary) throw new Error('Missing Prover entry')
  const manifest = assetManifest(
    data,
    prover.graph,
    proverEntries,
    primary.imports,
    records,
    external,
  )
  // Every published pair has an emitted prover and asset profile.
  tree.put(VERSIONS_PATH, JSON.stringify(versions), 'versions')
  tree.document(route('prover'), primary.code, 'prover')
  tree.document(route('prover/fallback'), primary.code, 'proverFallback')
  const callback = await bundle('src/ccdp/documents/callback.ts', data, {
    selfContained: true,
    invoke: 'startCallback',
  })
  for (const item of callback.output) {
    if (item.type !== 'chunk' || !item.isEntry) throw new Error('Callback must be self-contained')
    if (item.imports.length || item.dynamicImports.length || item.referencedFiles.length)
      throw new Error('Callback must have no external dependencies')
    const code = inlineScript(item.code)
    tree.put(
      CALLBACK_PATH,
      page(
        messages.brand,
        `<main id="libid-root"></main><script id="libid-callback-config" type="application/json">__LIBID_CALLBACK_CONFIG__</script><script type="module">${code}</script>`,
      ),
      responseHeaders('callback', { ...options, inline: [code] }),
    )
  }
  const prefetch = await bundle('src/ccdp/documents/prefetch.ts', data, {
    invoke: 'startPrefetch',
    fragment: true,
    manifest,
  })
  for (const item of prefetch.output) {
    if (item.type === 'chunk' && item.isEntry)
      tree.document(route('prefetch'), item.code, 'prefetch')
    else tree.put(`/${item.fileName}`, body(item), 'asset')
  }
  // Module Service Workers cannot import dynamically, so the root worker is one script.
  const worker = await bundle('src/assets/worker.entry.ts', data, {
    selfContained: true,
    manifest,
  })
  for (const item of worker.output) {
    if (item.type !== 'chunk' || !item.isEntry)
      throw new Error('The root worker must be one script')
    tree.put(route('worker.js'), item.code, 'worker')
  }
  // The page every 404 serves; requested directly it declares the same error policy.
  tree.put('/404.html', page(messages.notFoundTitle, `<p>${messages.notFound}</p>`), {
    'Content-Type': 'text/html; charset=utf-8',
    ...errorHeaders,
  })
  return { records, manifest, graph: prover.graph }
}

/** Build into a staging tree beside `--out-dir` and swap it in whole once it is complete. */
async function main() {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } }, strict: true })
  const out = outputDirectory(values['out-dir'] ?? artifactsDir)
  const staging = `${out}.building`
  mkdirSync(join(staging, 'public'), { recursive: true })
  try {
    const { records, manifest, graph } = await buildDistribution()
    const files = writeDistribution(staging, records)
    // Graph metadata stays outside public/: tests and e2e read it; it is never served.
    writeFileSync(
      join(staging, 'distribution-graph.json'),
      JSON.stringify({
        files,
        ...manifest,
        headers: Object.fromEntries([...records].map(([p, r]) => [p, r.headers])),
        graph: Object.fromEntries(graph),
      } satisfies DistributionMetadata),
    )
    swapInto(staging, out)
    console.log(`Built ${records.size} public resources in ${out}`)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) await main()
