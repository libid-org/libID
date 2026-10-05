// Start a local chain with the real libID contracts and, when this run binds
// Google (LIBID_LIVE_PLATFORMS), Google's keys rotated in; the notary, Bridge,
// CCDP and the indexer; with --app, also the bind application. No OAuth mocks.
//
// LIBID_STACK_LOGS names a file that takes every child's output, the
// containers' logs included, as it is written; without it they share ours.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  ceremonyProofVerifierAbi,
  googleJwtRootsAbi,
  identityRegistryAbi,
  platformId,
} from '@libid/contracts'
import { createPublicClient, http } from 'viem'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import {
  API,
  APP_ORIGIN,
  BRIDGE,
  CHAIN_ID,
  GOOGLE_JWT_ROOTS,
  livePlatforms,
  NOTARY,
  REGISTRY,
  RPC_URL,
  VERIFIER_VERSION,
} from './local.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const cache = join(root, '.cache')
const project = `libid-bind-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
const composeArgs = ['compose', '-p', project, '-f', join(root, 'compose.yaml')]

// Docker publishes on 127.0.0.1; the browser reaches Bridge as localhost.
const BRIDGE_ON_HOST = BRIDGE.replace('localhost', '127.0.0.1')
const chain = createPublicClient({ transport: http(RPC_URL) })
const platforms = livePlatforms(process.env)

const logs = process.env.LIBID_STACK_LOGS
/** Where children write: the LIBID_STACK_LOGS file, or our own output. */
const childOutput = logs
  ? (() => {
      const fd = openSync(logs, 'w')
      return ['ignore', fd, fd] as ['ignore', number, number]
    })()
  : 'inherit'

/** chain-configurations' deploy tool; it deploys the real verifiers, not stubs. */
const DEPLOY_VERSION = '0.15.0'
/** Each release archive's SHA-256, by Rust target. */
const DEPLOY_ARCHIVES: Record<string, string> = {
  'x86_64-unknown-linux-gnu': 'dc1cc678d861bf91494bcf827bd321904b6c3d5855df9821eafae2afd77914a6',
  'aarch64-unknown-linux-gnu': '7da9609d6a9f77b8d3699dadb7ed7b75a5df98ec473a59eeb1b7aff2a2c4b4b3',
  'x86_64-apple-darwin': '43e4d39ba6acc84289d843dd36e7ca271348a5a4c4bfb3653b907f0f5e94e6a9',
  'aarch64-apple-darwin': '042c444679473fa83ec8e089ea79d14df29f13c3a13e67b2c986524bf07e057e',
}

/** Aborted once the stack stops: waits end and running commands are terminated. */
const stopping = new AbortController()
const { signal } = stopping

/** Run a command to completion; reject on a nonzero exit or once the stack stops. */
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: childOutput, signal })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} exited with ${code}`)),
    )
  })
}

/** Poll `check` until it holds; reject on the deadline or once the stack stops. */
async function until(what: string, check: () => Promise<boolean>, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    try {
      if (await check()) return
    } catch {
      /* not up yet */
    }
    await delay(500, undefined, { signal })
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** Whether `url` answers 200 within a second. */
async function answers(url: string, init: RequestInit = {}): Promise<boolean> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(1000) })
  await response.body?.cancel()
  return response.status === 200
}

/** This host's libid-deploy, downloaded and checked against its pinned digest once. */
async function deployTool(): Promise<string> {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch as string]
  const os = { linux: 'unknown-linux-gnu', darwin: 'apple-darwin' }[process.platform as string]
  const target = `${arch}-${os}`
  const sha256 = DEPLOY_ARCHIVES[target]
  if (!arch || !os || !sha256)
    throw new Error(`libid-deploy has no release for ${process.platform} ${process.arch}`)
  const asset = `libid-deploy-${DEPLOY_VERSION}-${target}`
  const binary = join(cache, asset, 'libid-deploy')
  if (existsSync(binary)) return binary
  mkdirSync(cache, { recursive: true })
  const url = `https://github.com/libid-org/chain-configurations/releases/download/v${DEPLOY_VERSION}/${asset}.tar.gz`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Downloading ${url} answered ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== sha256)
    throw new Error(`libid-deploy archive digest ${digest} is not the pinned one`)
  execFileSync('tar', ['xz', '-C', cache], { input: archive })
  return binary
}

/** Whether something on this host accepts connections on `port`. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Refuse to start over another stack: with a port this project publishes
 * already taken, a check could pass against that stack, and the deploy would
 * go to its chain.
 */
async function portsFree() {
  const ports = [RPC_URL, NOTARY, BRIDGE, API].map((url) => Number(new URL(url).port))
  const open = await Promise.all(ports.map(listening))
  const taken = ports.filter((_, index) => open[index])
  if (taken.length)
    throw new Error(
      `Already in use on 127.0.0.1: port ${taken.join(', ')}. Stop the stack holding it (see docker ps).`,
    )
}

/** The quoted value of `key` in `text`, a TOML or YAML file's line `key = "…"` or `key: "…"`. */
function quoted(text: string, key: string, file: string): string {
  const value = new RegExp(`^\\s*${key}\\s*[=:]\\s*"([^"]*)"`, 'm').exec(text)?.[1]
  if (value === undefined) throw new Error(`${file} has no ${key}`)
  return value
}

/**
 * Fail fast when a copy of local-dev.toml's addresses has drifted: local.ts,
 * compose.yaml and keeper.toml repeat them, and bridge-config.toml admits
 * local.ts' app origin.
 */
function configAgrees() {
  const read = (file: string) => readFileSync(join(root, file), 'utf8')
  const network = read('local-dev.toml')
  const contracts = network.slice(network.indexOf('\n[contracts]'))
  const registry = quoted(contracts, 'identity_registry', 'local-dev.toml [contracts]')
  const roots = quoted(contracts, 'google_jwt_roots', 'local-dev.toml [contracts]')
  const copies: [string, string, string][] = [
    ['local.ts REGISTRY', REGISTRY, registry],
    ['local.ts GOOGLE_JWT_ROOTS', GOOGLE_JWT_ROOTS, roots],
    [
      'compose.yaml IDENTITY_NAMES_ADDRESS',
      quoted(read('compose.yaml'), 'IDENTITY_NAMES_ADDRESS', 'compose.yaml'),
      registry,
    ],
    [
      'keeper.toml google_jwt_roots',
      quoted(read('keeper.toml'), 'google_jwt_roots', 'keeper.toml'),
      roots,
    ],
  ]
  const drifted = copies.filter(([, copy, source]) => copy.toLowerCase() !== source.toLowerCase())
  const bridge = read('bridge-config.toml')
  if (!bridge.includes(`"${APP_ORIGIN}"`))
    drifted.push(['bridge-config.toml allowed_app_origins', '', APP_ORIGIN])
  if (drifted.length)
    throw new Error(
      `Out of step with local-dev.toml or local.ts: ${drifted.map(([name, , source]) => `${name} should be ${source}`).join('; ')}`,
    )
}

/** This checkout's stack lock: the pid of the stack.ts that owns the Compose project. */
const lock = join(cache, 'stack.pid')

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Own this checkout's Compose project, or refuse: a second stack.ts would
 * tear down the first one's containers. A lock whose process is gone is stale.
 */
function takeLock() {
  mkdirSync(cache, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      process.on('exit', releaseLock)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = Number(readFileSync(lock, 'utf8'))
    if (owner && alive(owner))
      throw new Error(`stack.ts (pid ${owner}) already runs this checkout's stack. Stop it first.`)
    rmSync(lock, { force: true })
  }
  throw new Error(`Could not take ${lock}`)
}

function releaseLock() {
  try {
    if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock)
  } catch {
    /* already gone */
  }
}

/** Deploy the stack to the fresh anvil with `tool`, then check what the app relies on. */
async function deploy(tool: Promise<string>) {
  await run(await tool, [
    'apply',
    '--network',
    join(root, 'local-dev.toml'),
    '--rpc-url',
    RPC_URL,
    '--yes',
    '--confirm-fresh-deploy',
    '--dev',
  ])
  // Two notary fees: the GitHub verifier is registered and the notary service wired.
  const quote = await chain.readContract({
    address: REGISTRY,
    abi: identityRegistryAbi,
    functionName: 'quoteBind',
    args: [platformId('github'), VERIFIER_VERSION],
  })
  if (quote !== 2_000_000_000_000_000n)
    throw new Error(`quoteBind(github, ${VERIFIER_VERSION}) is ${quote}, expected 2e15`)
  // Every platform this run binds has a verifier in the slot the app binds through.
  const proofVerifier = await chain.readContract({
    address: REGISTRY,
    abi: identityRegistryAbi,
    functionName: 'proofVerifier',
  })
  for (const platform of platforms) {
    const verifier = await chain.readContract({
      address: proofVerifier,
      abi: ceremonyProofVerifierAbi,
      functionName: 'verifierOf',
      args: [platformId(platform), VERIFIER_VERSION],
    })
    if (BigInt(verifier) === 0n)
      throw new Error(`No ${platform} verifier is registered at version ${VERIFIER_VERSION}`)
  }
}

/**
 * One keeper rotation: a notarized reading of Google's keys into
 * GoogleJwtRoots, which the Google verifier trusts. Without it no Google proof
 * verifies.
 */
async function rotateGoogleKeys() {
  await run('docker', [...composeArgs, '--profile', 'keeper', 'run', '--rm', 'keeper'])
  const stale = await chain.readContract({
    address: GOOGLE_JWT_ROOTS,
    abi: googleJwtRootsAbi,
    functionName: 'needsRotation',
  })
  if (stale) throw new Error('GoogleJwtRoots still needs a rotation after the keeper ran')
}

/** Bridge and the indexer API, which need neither the deploy nor the keeper. */
async function ready() {
  await Promise.all([
    until('Bridge', () =>
      answers(`${BRIDGE_ON_HOST}/api/v1/ceremony/config`, {
        headers: { Origin: APP_ORIGIN },
        redirect: 'error',
      }),
    ),
    until('indexer API', () => answers(`${API}/v1/status`)),
  ])
}

/** The chain's contracts, then Google's keys when this run binds Google. */
async function chainReady(tool: Promise<string>) {
  await deploy(tool)
  if (platforms.includes('google')) await rotateGoogleKeys()
}

/** Report `error` and exit before the stack has started. */
function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

/** `promise`, marked handled: its rejection reaches whoever awaits it later instead of ending the process first. */
function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

// ─── Main ───────────────────────────────────────────────────────

try {
  configAgrees()
  takeLock()
} catch (error) {
  fail(error)
}
// The deploy tool downloads and CCDP builds while Docker clears a stack this
// checkout left behind, volumes and all, so every run starts from a fresh
// chain and database; a port still taken then belongs to another stack. The
// images come down before anything is timed.
const tool = started(deployTool())
const ccdp = started(
  run('pnpm', [
    '--filter',
    '@libid/ceremony',
    'build:ccdp-artifacts',
    '--out-dir',
    join(cache, 'ccdp'),
  ]),
)
try {
  await Promise.all([
    run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']),
    run('docker', [...composeArgs, '--profile', 'keeper', 'pull', '--quiet']),
  ])
} catch {
  fail(
    'Could not run Docker Compose or pull its images. Install Docker with Compose and start its engine.',
  )
}
try {
  await ccdp
  await portsFree()
} catch (error) {
  fail(error)
}

let frontend: ViteDevServer | undefined
/** Stop what this process started: the frontend, then its own Compose project. */
function stop(code: number) {
  if (signal.aborted) return
  stopping.abort()
  process.exitCode = code
  void frontend?.close()
  if (compose.pid) {
    try {
      process.kill(-compose.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const down = spawn('docker', [...composeArgs, 'down', '--volumes'], { stdio: childOutput })
  down.on('error', () => console.error('Could not stop the stack containers. Check Docker.'))
  down.on('close', (code) => {
    if (code !== 0) process.exitCode = 1
  })
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
const compose = spawn('docker', [...composeArgs, 'up', '--abort-on-container-failure'], {
  stdio: childOutput,
  detached: true,
})
compose.on('error', () => {
  console.error('Could not start Docker Compose. Install Docker with Compose and start its engine.')
  stop(1)
})
compose.on('exit', (code) => stop(code || 1))

try {
  await until('anvil', async () => (await chain.getChainId()) === CHAIN_ID)
  await Promise.all([chainReady(tool), ready()])
  signal.throwIfAborted()
  console.info(`Stack ready: chain ${RPC_URL}, registry ${REGISTRY}, indexer ${API}`)
  if (process.argv.includes('--app')) {
    frontend = await createViteServer({ configFile: join(root, 'vite.config.ts') })
    if (signal.aborted) await frontend.close()
    else {
      await frontend.listen()
      frontend.printUrls()
    }
  }
} catch (error) {
  if (!signal.aborted) {
    console.error(error instanceof Error ? error.message : error)
    stop(1)
  }
}
