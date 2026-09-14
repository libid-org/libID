import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDir = fileURLToPath(new URL('../', import.meta.url))

export const cache = join(packageDir, '.cache')

/** Internal cache/bundler identity, not a source integrity requirement. */
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export type DownloadOptions = {
  fetch?: typeof fetch
  /** GitHub API token; unauthenticated lookups are limited to 60 per hour per address. */
  token?: string
  cacheDir?: string
  warn?: (message: string) => void
}

/** A GitHub release asset URL, mapped to the release document that records its digest. */
export function releaseAsset(url: string): { api: string; name: string } | undefined {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url)
  if (!match) return undefined
  const [, owner, repo, tag, name] = match
  return {
    api: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    name: decodeURIComponent(name),
  }
}

/** Throws unless `bytes` hash to `digest` (`sha256:<hex>`, as GitHub records it). */
export function verifyDigest(bytes: Uint8Array, digest: string, subject: string) {
  const [algorithm, expected] = digest.split(':')
  if (algorithm !== 'sha256' || !/^[0-9a-f]{64}$/.test(expected ?? ''))
    throw new Error(`Unsupported release asset digest for ${subject}: ${digest}`)
  const actual = hash(bytes)
  if (actual !== expected)
    throw new Error(
      `Release asset digest mismatch for ${subject}: expected sha256:${expected}, got sha256:${actual}`,
    )
}

/** The digest GitHub recorded for the asset, or undefined when the release lists none. */
async function releaseDigest(
  asset: { api: string; name: string },
  fetchImpl: typeof fetch,
  token: string | undefined,
): Promise<string | undefined> {
  const response = await fetchImpl(asset.api, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`Release lookup failed (${response.status}): ${asset.api}`)
  const release = (await response.json()) as { assets?: { name: string; digest?: string | null }[] }
  return release.assets?.find((a) => a.name === asset.name)?.digest ?? undefined
}

/**
 * Downloads once into the cache. GitHub release assets are verified, fresh or
 * cached, against the digest GitHub records for them; a mismatch fails. A
 * release without a digest, or an unreachable release document with a cached
 * download, warns and continues.
 */
export async function download(url: string, options: DownloadOptions = {}): Promise<Buffer> {
  const {
    fetch: fetchImpl = fetch,
    token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    cacheDir = join(cache, 'downloads'),
    warn = (message: string) => console.warn(message),
  } = options
  const path = join(cacheDir, encodeURIComponent(url))
  const cached = existsSync(path) ? readFileSync(path) : undefined
  const asset = releaseAsset(url)
  let digest: string | undefined
  if (asset) {
    try {
      digest = await releaseDigest(asset, fetchImpl, token)
      if (digest === undefined) warn(`No release digest recorded for ${url}; not verified`)
    } catch (error) {
      if (!cached) throw error
      warn(`Release digest unavailable for ${url}; using the cached download unverified (${error})`)
    }
  }
  if (cached) {
    if (digest) verifyDigest(cached, digest, `${url} (cached at ${path})`)
    return cached
  }
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Release download failed: ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (digest) verifyDigest(bytes, digest, url)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(path, bytes)
  return bytes
}
