// Start a local chain with the real libID contracts and, when this run binds
// Google (LIBID_LIVE_PLATFORMS), Google's keys rotated in; the notary, Bridge,
// CCDP and the indexer; with --app, also the bind application. No OAuth mocks.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
const BRIDGE = 'http://127.0.0.1:4682'
const chain = createPublicClient({ transport: http(RPC_URL) })

/** chain-configurations' deploy tool; it deploys the real verifiers, not stubs. */
const DEPLOY = {
  version: '0.15.0',
  asset: 'libid-deploy-0.15.0-x86_64-unknown-linux-gnu',
  sha256: 'dc1cc678d861bf91494bcf827bd321904b6c3d5855df9821eafae2afd77914a6',
}

/** Run a command to completion, its output on ours; reject on a nonzero exit. */
function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} exited with ${code}`)),
    )
  })
}

let stopping = false

/** Poll `check` until it holds; reject on the deadline or once the stack is stopping. */
async function until(what: string, check: () => Promise<boolean>, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    if (stopping) throw new Error(`Stopped while waiting for ${what}`)
    try {
      if (await check()) return
    } catch {
      /* not up yet */
    }
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function deployTool(): Promise<string> {
  const binary = join(cache, DEPLOY.asset, 'libid-deploy')
  if (existsSync(binary)) return binary
  mkdirSync(cache, { recursive: true })
  const url = `https://github.com/libid-org/chain-configurations/releases/download/v${DEPLOY.version}/${DEPLOY.asset}.tar.gz`
  const archive = Buffer.from(await (await fetch(url)).arrayBuffer())
  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== DEPLOY.sha256)
    throw new Error(`libid-deploy archive digest ${digest} is not the pinned one`)
  const path = join(cache, `${DEPLOY.asset}.tar.gz`)
  writeFileSync(path, archive)
  execFileSync('tar', ['xzf', path, '-C', cache])
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
  const taken = []
  for (const port of ports) if (await listening(port)) taken.push(port)
  if (taken.length)
    throw new Error(
      `Already in use on 127.0.0.1: port ${taken.join(', ')}. Stop the stack holding it (see docker ps).`,
    )
}

/** Deploy the stack to the fresh anvil, then check what the app relies on. */
async function deploy() {
  const tool = await deployTool()
  await run(tool, [
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
  for (const platform of livePlatforms(process.env)) {
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

async function ready() {
  const bridge = until('Bridge', async () => {
    const response = await fetch(`${BRIDGE}/api/v1/ceremony/config`, {
      headers: { Origin: APP_ORIGIN },
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    })
    await response.body?.cancel()
    return response.status === 200
  })
  const api = until('indexer API', async () => {
    const response = await fetch(`${API}/v1/status`, { signal: AbortSignal.timeout(1000) })
    await response.body?.cancel()
    return response.status === 200
  })
  await Promise.all([bridge, api])
}

/** The chain's contracts, then Google's keys when this run binds Google. */
async function chainReady() {
  if (stopping) return
  await deploy()
  if (stopping) return
  if (livePlatforms(process.env).includes('google')) await rotateGoogleKeys()
}

// ─── Main ───────────────────────────────────────────────────────

execFileSync(
  'pnpm',
  ['--filter', '@libid/ceremony', 'build:ccdp-artifacts', '--out-dir', join(cache, 'ccdp')],
  { cwd: root, stdio: 'inherit' },
)
// A stack this checkout left behind goes first, volumes and all, so every run
// starts from a fresh chain and database; a port still taken then belongs to
// another stack.
try {
  await run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'])
} catch {
  console.error('Could not run Docker Compose. Install Docker with Compose and start its engine.')
  process.exit(1)
}
try {
  await portsFree()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

let frontend: ViteDevServer | undefined
function stop(code: number) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  void frontend?.close()
  if (compose.pid) {
    try {
      process.kill(-compose.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  // LIBID_STACK_LOGS keeps every container's log, for a failed CI run to upload.
  const logs = process.env.LIBID_STACK_LOGS
  if (logs) {
    try {
      writeFileSync(
        logs,
        execFileSync('docker', [...composeArgs, 'logs', '--no-color'], { maxBuffer: 1 << 28 }),
      )
    } catch {
      console.error('Could not save the container logs.')
    }
  }
  const down = spawn('docker', [...composeArgs, 'down', '--volumes'], { stdio: 'inherit' })
  down.on('error', () => console.error('Could not stop the stack containers. Check Docker.'))
  down.on('close', (code) => {
    if (code !== 0) process.exitCode = 1
  })
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
const compose = spawn('docker', [...composeArgs, 'up', '--abort-on-container-failure'], {
  stdio: 'inherit',
  detached: true,
})
compose.on('error', () => {
  console.error('Could not start Docker Compose. Install Docker with Compose and start its engine.')
  stop(1)
})
compose.on('exit', (code) => {
  if (!stopping) stop(code || 1)
})

try {
  await until('anvil', async () => (await chain.getChainId()) === CHAIN_ID)
  // Bridge and the indexer need neither the deploy nor the keeper.
  if (!stopping) await Promise.all([chainReady(), ready()])
  if (!stopping) {
    console.info(`Stack ready: chain ${RPC_URL}, registry ${REGISTRY}, indexer ${API}`)
    if (process.argv.includes('--app')) {
      frontend = await createViteServer({ configFile: join(root, 'vite.config.ts') })
      if (stopping) await frontend.close()
      else {
        await frontend.listen()
        frontend.printUrls()
      }
    }
  }
} catch (error) {
  if (!stopping) {
    console.error(error instanceof Error ? error.message : error)
    stop(1)
  }
}
