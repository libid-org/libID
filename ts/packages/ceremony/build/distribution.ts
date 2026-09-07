import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { parse } from 'smol-toml'
import type { Rollup } from 'vite'
import type { AssetRequest } from '../src/assets.js'
import type { ResolvedAssets } from './assets.ts'
import { resolveAssets } from './assets.ts'
import type { BundleNode } from './bundle.ts'
import { bundle } from './bundle.ts'
import type { ResponseProfile } from './profiles.ts'
import { responseHeaders } from './profiles.ts'
import { hash, packageDir } from './release.ts'
export type DistributionMetadata = Pick<ResolvedAssets, 'requestsByProfile' | 'allowedRequests'> & {
  headers: Record<string, Record<string, string>>
  graph: Record<string, BundleNode>
}
const index = process.argv.indexOf('--out-dir'),
  out = resolve(index < 0 ? join(packageDir, 'dist-artifacts') : process.argv[index + 1])
if (out === packageDir || !out.startsWith(`${resolve(packageDir, '../../..')}/`))
  throw new Error('Output must be a dedicated directory inside this worktree')
const staging = `${out}.building`
if (existsSync(staging)) throw new Error('Build staging directory already exists')
mkdirSync(join(staging, 'public'), { recursive: true })
const publicDir = join(staging, 'public')
try {
  const data = await resolveAssets(publicDir),
    records = new Map<string, { bytes: Buffer; headers: Record<string, string> }>(),
    workerFiles = new Set<string>()
  const options = {
    externalOrigins: [
      ...new Set(
        Object.values(data.profiles)
          .flat()
          .filter((a) => a.mode === 'external')
          .flatMap((a) => a.urls.map((u) => new URL(u).origin)),
      ),
    ],
    notaryAddress: data.notaryAddress,
  }
  const put = (
    path: string,
    body: string | Uint8Array,
    profile: ResponseProfile,
    headers: Record<string, string> = {},
  ) => {
    const bytes = Buffer.from(body),
      old = records.get(path)
    if (old && !old.bytes.equals(bytes)) throw new Error(`Conflicting output: ${path}`)
    records.set(path, {
      bytes,
      headers: {
        ...responseHeaders(profile, options),
        ...(profile === 'asset'
          ? {
              'Content-Type': path.endsWith('.js')
                ? 'text/javascript; charset=utf-8'
                : path.endsWith('.wasm')
                  ? 'application/wasm'
                  : path.endsWith('.json')
                    ? 'application/json'
                    : 'application/octet-stream',
            }
          : {}),
        ...headers,
        ETag: `"${hash(bytes)}"`,
      },
    })
  }
  for (const path of data.local)
    put(
      path,
      readFileSync(join(publicDir, path)),
      path.endsWith('.js') ? 'executionWorker' : 'asset',
      {
        'Content-Type': path.endsWith('.json')
          ? 'application/json'
          : path.endsWith('.wasm')
            ? 'application/wasm'
            : path.endsWith('.js')
              ? 'text/javascript; charset=utf-8'
              : 'application/octet-stream',
      },
    )
  const emitted = await bundle('src/ccdp/documents/prover.ts', data, { invoke: 'startProver' })
  for (const path of emitted.workerFiles) workerFiles.add(path)
  const graph = emitted.graph
  const workerProfile = (file: string): ResponseProfile => {
    const modules = graph.get(file)?.modules ?? []
    if (modules.some((m) => m.includes('/notarization/'))) return 'executionWorker'
    return modules.some((m) => m.endsWith('?worker&url')) ? 'proofWorker' : 'leafWorker'
  }
  for (const item of emitted.output) {
    if (item.type !== 'chunk' || !item.isEntry)
      put(
        `/${item.fileName}`,
        item.type === 'chunk' ? item.code : item.source,
        workerFiles.has(item.fileName) && item.fileName.endsWith('.js')
          ? workerProfile(item.fileName)
          : 'asset',
      )
  }
  const walk = (file: string, set = new Set<string>()): Set<string> => {
    if (set.has(file)) return set
    set.add(file)
    for (const next of graph.get(file)?.dependencies ?? []) walk(next.replace(/^\//, ''), set)
    return set
  }
  for (const [profile, assets] of Object.entries(data.profiles)) {
    const platform = profile.split('/')[0],
      entry = [...graph.entries()].find(([, v]) =>
        v.entry?.endsWith(`/platforms/${platform}/1/prover.ts`),
      )?.[0]
    if (!entry) throw new Error(`Missing emitted platform entry: ${profile}`)
    const requests: AssetRequest[] = assets.map((a) =>
      a.mode === 'external'
        ? { url: a.urls[0], range: a.range, bytes: a.bytes }
        : {
            url: data.urls[a.id],
            bytes: data.sizes[data.urls[a.id]],
            mime: records.get(data.urls[a.id])!.headers['Content-Type'].split(';')[0],
          },
    )
    for (const file of walk(entry)) {
      const record = records.get(`/${file}`)
      if (!record) throw new Error(`Unindexed dependency: ${file}`)
      requests.push({
        url: `/${file}`,
        bytes: record.bytes.length,
        mime: record.headers['Content-Type'].split(';')[0],
      })
    }
    data.requestsByProfile[profile] = [
      ...new Map(requests.map((r) => [`${r.url}\n${r.range ?? ''}`, r])).values(),
    ]
  }
  data.allowedRequests = [
    ...new Map(
      [
        ...Object.values(data.requestsByProfile).flat(),
        ...Object.values(data.profiles)
          .flat()
          .filter((a) => a.mode === 'external')
          .flatMap((a) => a.urls.map((url) => ({ url, range: a.range, bytes: a.bytes }))),
      ].map((r) => [`${r.url}\n${r.range ?? ''}`, r]),
    ).values(),
  ]
  const primary = emitted.output.find(
    (o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry,
  )
  if (!primary) throw new Error('Missing Prover entry')
  const document = (path: string, code: string, profile: ResponseProfile) => {
    const capture = `(()=>{const query=location.search,fragment=location.hash,path=location.pathname;history.replaceState(null,'',path);if(query||path!==${JSON.stringify(path)}||fragment.length>65536){document.getElementById('libid-root').textContent='Unable to continue. Return to your application.';return}Object.defineProperty(window,'__libidCeremonyInput',{value:fragment,configurable:true})})()`
    const entry = code
    const scripts = [capture, entry].map((s) => s.replace(/<\/script/gi, '<\\/script'))
    put(
      path,
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>libID</title><body><main id="libid-root"></main><script>${scripts[0]}</script><script type="module">${scripts[1]}</script></body></html>`,
      profile,
      responseHeaders(profile, { ...options, inline: scripts }),
    )
  }
  document('/ccdp/v1/prover', primary.code, 'prover')
  document('/ccdp/v1/prover/fallback', primary.code, 'proverFallback')
  const callback = await bundle('src/ccdp/documents/callback.ts', data, {
    selfContained: true,
    invoke: 'startCallback',
  })
  for (const item of callback.output) {
    if (item.type !== 'chunk' || !item.isEntry) throw new Error('Callback must be self-contained')
    if (item.imports.length || item.dynamicImports.length || item.referencedFiles.length)
      throw new Error('Callback must have no external dependencies')
    const code = item.code.replace(/<\/script/gi, '<\\/script')
    put(
      '/ccdp/callback.html',
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>libID</title><body><main id="libid-root"></main><script id="libid-callback-config" type="application/json">__LIBID_CALLBACK_CONFIG__</script><script type="module">${code}</script></body></html>`,
      'callback',
      responseHeaders('callback', { ...options, inline: [code] }),
    )
  }
  const prefetch = await bundle('src/ccdp/documents/prefetch.ts', data, { invoke: 'startPrefetch' })
  for (const item of prefetch.output) {
    if (item.type === 'chunk' && item.isEntry) {
      document('/ccdp/v1/prefetch', item.code, 'prefetch')
      put('/ccdp/v1/worker.js', item.code, 'worker')
    } else put(`/${item.fileName}`, item.type === 'chunk' ? item.code : item.source, 'asset')
  }
  put(
    '/404.html',
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found</title><p>Not found.</p></html>',
    'prefetch',
    { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" },
  )
  // Carry previous immutable responses forward, including their original policies.
  // Mutable route entries always come from this build. No runtime manifest is emitted.
  if (existsSync(join(out, 'sws.toml'))) {
    const previous = parse(readFileSync(join(out, 'sws.toml'), 'utf8')) as {
      advanced?: { headers?: { source: string; headers: Record<string, string> }[] }
    }
    for (const entry of previous.advanced?.headers ?? []) {
      const source = entry.source
      if (typeof source !== 'string' || !source.startsWith('/ccdp/assets/')) continue
      const path = source.slice(0, source.lastIndexOf('/'))
      if (path.includes('..') || source !== `${path}/${basename(path)}`)
        throw new Error('Invalid previous asset path')
      const bytes = readFileSync(join(out, 'public', path)),
        headers = entry.headers
      if (
        headers.ETag !== `"${hash(bytes)}"` ||
        headers['Cache-Control'] !== 'public, max-age=31536000, immutable'
      )
        throw new Error('Invalid previous immutable response')
      const current = records.get(path)
      if (current) {
        if (
          !current.bytes.equals(bytes) ||
          JSON.stringify({ ...current.headers, Vary: undefined }) !==
            JSON.stringify({ ...headers, Vary: undefined })
        )
          throw new Error(`Immutable response changed: ${path}`)
      } else records.set(path, { bytes, headers })
    }
  }
  const baseline = `[general]\nhost = "::"\nport = 80\nroot = "/home/sws/public"\npage404 = "/home/sws/public/404.html"\ncache-control-headers = false\ncompression = false\ncompression-static = true\nsecurity-headers = false\ndirectory-listing = false\nredirect-trailing-slash = false\nhealth = false\ntext-charset = false\n`
  let config = baseline
  for (const [path, { bytes, headers }] of records) {
    const physical = path === '/ccdp/v1/prover' ? `${path}/index.html` : path,
      target = join(publicDir, physical)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    const compressed = brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    })
    if (compressed.length < bytes.length) {
      if (!brotliDecompressSync(compressed).equals(bytes)) throw new Error('Invalid Brotli sidecar')
      writeFileSync(`${target}.br`, compressed)
      headers.Vary = 'Accept-Encoding'
    }
    config +=
      `\n[[advanced.headers]]\nsource = ${JSON.stringify(`${path}/${basename(physical)}`)}\n[advanced.headers.headers]\n` +
      Object.entries(headers)
        .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}\n`)
        .join('')
  }
  writeFileSync(join(staging, 'sws.toml'), config)
  // Qualification metadata stays outside the public artifact and is not a runtime manifest.
  mkdirSync(join(packageDir, '.cache'), { recursive: true })
  writeFileSync(
    join(packageDir, '.cache/distribution-graph.json'),
    JSON.stringify({
      requestsByProfile: data.requestsByProfile,
      allowedRequests: data.allowedRequests,
      headers: Object.fromEntries([...records].map(([p, r]) => [p, r.headers])),
      graph: Object.fromEntries(graph),
    } satisfies DistributionMetadata),
  )
  if (existsSync(out)) {
    const previous = `${out}.previous`
    if (existsSync(previous)) throw new Error('Previous output already exists')
    renameSync(out, previous)
    try {
      renameSync(staging, out)
    } catch (error) {
      renameSync(previous, out)
      throw error
    }
    rmSync(previous, { recursive: true })
  } else renameSync(staging, out)
  console.log(`Built ${records.size} public resources in ${out}`)
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  throw error
}
