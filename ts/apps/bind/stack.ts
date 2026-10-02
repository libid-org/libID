// Start a local chain with the real libID contracts, the notary, Bridge, CCDP
// and the indexer; with --app, also the bind application. No OAuth mocks.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { identityRegistryAbi, platformId } from '@libid/contracts'
import { createPublicClient, http } from 'viem'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const cache = join(root, '.cache')
const project = `libid-bind-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
const composeArgs = ['compose', '-p', project, '-f', join(root, 'compose.yaml')]

export const RPC_URL = 'http://127.0.0.1:4688'
export const REGISTRY = '0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366' as const
const BRIDGE = 'http://127.0.0.1:4682'
const API = 'http://127.0.0.1:4689'
const APP_ORIGIN = 'http://localhost:4695'

/** chain-configurations' deploy tool; it deploys the real verifiers, not stubs. */
const DEPLOY = {
  version: '0.14.0',
  asset: 'libid-deploy-0.14.0-x86_64-unknown-linux-gnu',
  sha256: '131166dcc90dcbcbb9b10d471310ed34db30062328a5e5e03789d9636b61dc9c',
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(2000),
  })
  const body = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result
}

async function until(what: string, check: () => Promise<boolean>, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
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

/** Deploy the stack to the fresh anvil, then check what the app relies on. */
async function deploy() {
  const tool = await deployTool()
  execFileSync(
    tool,
    [
      'apply',
      '--network',
      join(root, 'local-dev.toml'),
      '--rpc-url',
      RPC_URL,
      '--yes',
      '--confirm-fresh-deploy',
      '--dev',
    ],
    { stdio: 'inherit' },
  )
  const chain = createPublicClient({ transport: http(RPC_URL) })
  // Two notary fees: the GitHub verifier is registered and the notary service wired.
  const quote = await chain.readContract({
    address: REGISTRY,
    abi: identityRegistryAbi,
    functionName: 'quoteBind',
    args: [platformId('github'), 1],
  })
  if (quote !== 2_000_000_000_000_000n)
    throw new Error(`quoteBind(github, 1) is ${quote}, expected 2e15`)
  const code = (await rpc('eth_getCode', [REGISTRY, 'latest'])) as string
  if (code === '0x') throw new Error('IdentityRegistry has no code after deploy')
}

async function ready() {
  await until('Bridge', async () => {
    const response = await fetch(`${BRIDGE}/api/v1/ceremony/config`, {
      headers: { Origin: APP_ORIGIN },
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    })
    await response.body?.cancel()
    return response.status === 200
  })
  await until('indexer API', async () => {
    const response = await fetch(`${API}/v1/status`, { signal: AbortSignal.timeout(1000) })
    await response.body?.cancel()
    return response.status === 200
  })
}

// ─── Main ───────────────────────────────────────────────────────

execFileSync(
  'pnpm',
  ['--filter', '@libid/ceremony', 'build:ccdp-artifacts', '--out-dir', join(cache, 'ccdp')],
  { cwd: root, stdio: 'inherit' },
)

let frontend: ViteDevServer | undefined
let stopping = false
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
  await until('anvil', async () => (await rpc('eth_chainId', [])) === '0x7a69')
  await deploy()
  await ready()
  console.info(`Stack ready: chain ${RPC_URL}, registry ${REGISTRY}, indexer ${API}`)
  if (process.argv.includes('--app') && !stopping) {
    frontend = await createViteServer({ configFile: join(root, 'vite.config.ts') })
    await frontend.listen()
    frontend.printUrls()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  stop(1)
}
