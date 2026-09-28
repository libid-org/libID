// Populate assets/ with every static file @libid/claim loads at runtime.
// Runs as the first half of `pnpm build`, before publishing; consumers of
// the published tarball never run it — the assets ship inside the tarball.
//
//   assets/tlsn_wasm.js, tlsn_wasm_bg.wasm, spawn.js   ← libid-org/notary release
//   assets/circuits/x_token.json          (X)          ← libid-org/libID-circuits
//   assets/circuits/jwt_email.json        (Google)     ← libid-org/libID-circuits
//   assets/circuits/manifest.json                      ← the release manifest (provenance)
//   assets/wasm/acvm_js_bg.wasm, noirc_abi_wasm_bg.wasm ← @noir-lang/* in node_modules
//
// The release tags come from package.json's `libid` field (env
// NOTARY_RELEASE / CIRCUITS_RELEASE override). Circuit tarballs are
// sha256-verified against the release manifest, and each extracted file
// against the manifest's per-file hash.
//
// Toolchain tie: the circuits release records the exact bb/nargo that built
// the artifacts. This script FAILS if @libid/claim's @aztec/bb.js or
// @noir-lang/noir_js pin does not match — bump either without recutting the
// circuits release (or vice versa) and the build stops here. See
// src/index.test.ts for the runtime half of that check (vk derivation).
//
// Idempotent: a matching assets/.stamp.json skips the network entirely.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const require = createRequire(import.meta.url)

const NOTARY_RELEASE = process.env.NOTARY_RELEASE ?? pkg.libid.notaryRelease
const CIRCUITS_RELEASE = process.env.CIRCUITS_RELEASE ?? pkg.libid.circuitsRelease

const assets = join(pkgDir, 'assets')
const stampFile = join(assets, '.stamp.json')
const stamp = { notaryRelease: NOTARY_RELEASE, circuitsRelease: CIRCUITS_RELEASE }

/** Resolve an installed package's root directory without consulting its
 *  exports map (wasm files are often not exported subpaths). */
function packageRoot(name) {
  const entry = realpathSync(require.resolve(name))
  const marker = join('node_modules', ...name.split('/'))
  const at = entry.lastIndexOf(marker)
  if (at !== -1) return entry.slice(0, at + marker.length)
  // Workspace link: realpath escapes node_modules; walk up to package.json.
  let dir = dirname(entry)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  throw new Error(`cannot locate package root of ${name} from ${entry}`)
}

const claimPkg = JSON.parse(readFileSync(join(packageRoot('@libid/claim'), 'package.json'), 'utf8'))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function fetchBytes(url, attempts = 3) {
  console.log(`==> fetch ${url}`)
  for (let i = 1; ; i++) {
    try {
      const resp = await fetch(url, { redirect: 'follow' })
      if (!resp.ok) throw new Error(`GET ${url} failed: ${resp.status}`)
      return Buffer.from(await resp.arrayBuffer())
    } catch (err) {
      if (i >= attempts) throw err
      console.warn(`   retrying (${i}/${attempts - 1} failed): ${err.message ?? err}`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

function untar(tarball, dest) {
  mkdirSync(dest, { recursive: true })
  const r = spawnSync('tar', ['-xzf', tarball, '-C', dest], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`tar -xzf ${tarball} failed`)
}

function findFile(dir, name) {
  const r = spawnSync('find', [dir, '-name', name], { encoding: 'utf8' })
  const hit = r.stdout.split('\n').filter(Boolean)[0]
  if (!hit) throw new Error(`${name} missing under ${dir}`)
  return hit
}

// ── toolchain tie check (fails the build on any drift) ─────────────────────
const manifestUrl = `https://github.com/libid-org/libID-circuits/releases/download/${CIRCUITS_RELEASE}/manifest.json`
const manifest = JSON.parse((await fetchBytes(manifestUrl)).toString('utf8'))

const bbPin = claimPkg.dependencies['@aztec/bb.js']
const noirPin = claimPkg.dependencies['@noir-lang/noir_js']
const ourBbPin = pkg.devDependencies['@aztec/bb.js']
const fail = (msg) => {
  console.error(`ERROR: ${msg}`)
  console.error(
    'The libid-circuits release artifacts (circuits, vks, on-chain verifiers) are built by EXACTLY the toolchain the manifest names. Moving the @aztec/bb.js / @noir-lang pins without recutting the circuits release (and redeploying its verifiers) breaks proving — see the "Toolchain" note in @libid/claim.',
  )
  process.exit(1)
}
if (manifest.toolchain.bb !== bbPin)
  fail(
    `@libid/claim pins @aztec/bb.js ${bbPin}, circuits release ${CIRCUITS_RELEASE} was built by bb ${manifest.toolchain.bb}`,
  )
if (manifest.toolchain.bb !== ourBbPin)
  fail(
    `@libid/claim-full devDep @aztec/bb.js ${ourBbPin} != circuits toolchain bb ${manifest.toolchain.bb}`,
  )
if (manifest.toolchain.nargo !== noirPin)
  fail(
    `@libid/claim pins @noir-lang/noir_js ${noirPin}, circuits release ${CIRCUITS_RELEASE} was compiled by nargo ${manifest.toolchain.nargo}`,
  )
console.log(`toolchain tie OK: bb ${bbPin}, nargo ${noirPin} == circuits ${CIRCUITS_RELEASE}`)

// ── skip when already staged for these exact releases ──────────────────────
if (existsSync(stampFile)) {
  const prev = JSON.parse(readFileSync(stampFile, 'utf8'))
  if (JSON.stringify(prev) === JSON.stringify(stamp)) {
    console.log(
      `assets/ already staged for notary ${NOTARY_RELEASE} + circuits ${CIRCUITS_RELEASE}; skipping fetch`,
    )
    process.exit(0)
  }
}
rmSync(assets, { recursive: true, force: true })
mkdirSync(join(assets, 'circuits'), { recursive: true })
mkdirSync(join(assets, 'wasm'), { recursive: true })

const work = mkdtempSync(join(tmpdir(), 'claim-full-assets-'))
try {
  // ── tlsn wasm bundle (X flow's MPC/Proxy prover) ─────────────────────────
  const tlsnVer = NOTARY_RELEASE.replace(/^v/, '')
  const tlsnTar = join(work, 'tlsn-wasm.tar.gz')
  writeFileSync(
    tlsnTar,
    await fetchBytes(
      `https://github.com/libid-org/notary/releases/download/${NOTARY_RELEASE}/tlsn-wasm-${tlsnVer}.tar.gz`,
    ),
  )
  untar(tlsnTar, join(work, 'tlsn'))
  for (const f of ['tlsn_wasm.js', 'tlsn_wasm_bg.wasm', 'spawn.js']) {
    copyFileSync(findFile(join(work, 'tlsn'), f), join(assets, f))
    console.log(`staged assets/${f}`)
  }

  // ── circuits (verified against the release manifest) ─────────────────────
  const circVer = CIRCUITS_RELEASE.replace(/^v/, '')
  const circBase = `https://github.com/libid-org/libID-circuits/releases/download/${CIRCUITS_RELEASE}`
  const stageCircuit = async (suffix, jsonName) => {
    const tarName = `libid-circuits-${circVer}-${suffix}.tar.gz`
    const entry = manifest.tarballs[tarName]
    if (!entry) throw new Error(`${tarName} not in the release manifest`)
    const bytes = await fetchBytes(`${circBase}/${tarName}`)
    if (sha256(bytes) !== entry.sha256)
      throw new Error(`${tarName} sha256 mismatch (manifest ${entry.sha256}, got ${sha256(bytes)})`)
    const tarPath = join(work, tarName)
    writeFileSync(tarPath, bytes)
    untar(tarPath, join(work, suffix))
    const src = findFile(join(work, suffix), jsonName)
    const fileBytes = readFileSync(src)
    if (sha256(fileBytes) !== entry.files[jsonName])
      throw new Error(`${jsonName} sha256 mismatch inside ${tarName}`)
    writeFileSync(join(assets, 'circuits', jsonName), fileBytes)
    console.log(`staged assets/circuits/${jsonName} (from ${tarName})`)
  }
  await stageCircuit('x-token', 'x_token.json')
  await stageCircuit('jwt_email', 'jwt_email.json')
  writeFileSync(join(assets, 'circuits', 'manifest.json'), JSON.stringify(manifest, null, 2))

  // ── noir wasm (worker prover init), resolved through @libid/claim ────────
  // so the staged wasm matches the versions ITS lockfile entry pins.
  const claimRequire = createRequire(join(packageRoot('@libid/claim'), 'package.json'))
  const claimPackageRoot = (name) => {
    const entry = realpathSync(claimRequire.resolve(name))
    const marker = join('node_modules', ...name.split('/'))
    const at = entry.lastIndexOf(marker)
    if (at === -1) throw new Error(`cannot locate ${name} from ${entry}`)
    return entry.slice(0, at + marker.length)
  }
  for (const [name, rel, out] of [
    ['@noir-lang/acvm_js', 'web/acvm_js_bg.wasm', 'acvm_js_bg.wasm'],
    ['@noir-lang/noirc_abi', 'web/noirc_abi_wasm_bg.wasm', 'noirc_abi_wasm_bg.wasm'],
  ]) {
    copyFileSync(join(claimPackageRoot(name), rel), join(assets, 'wasm', out))
    console.log(`staged assets/wasm/${out}`)
  }

  writeFileSync(stampFile, JSON.stringify(stamp, null, 2))
  console.log(`\nassets/ staged for notary ${NOTARY_RELEASE} + circuits ${CIRCUITS_RELEASE}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
