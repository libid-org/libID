// Start the real Bridge, notary and emitted CCDP; no OAuth mocks.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
// Rebuild the shared distribution; immutable assets reuse the build cache.
execFileSync(
  'pnpm',
  ['--filter', '@libid/ceremony', 'build:ccdp-artifacts', '--out-dir', join(root, '.cache/ccdp')],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
let frontend: ViteDevServer | undefined
let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  void frontend?.close()
  // Stop the producer before teardown; CLI plugins share this owned process group.
  if (compose.pid) {
    try {
      process.kill(-compose.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  // Keep this child alive through completion, including after a partial startup.
  const down = spawn('docker', [...composeArgs, 'down'], { stdio: 'inherit' })
  down.on('error', () => console.error('Could not stop development containers. Check Docker.'))
  down.on('close', (code) => {
    if (code !== 0) process.exitCode = 1
  })
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
// Distinct Compose ownership for each checkout. No shared container names.
const project = `libid-dev-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
const composeArgs = ['compose', '-p', project, '-f', join(root, 'compose.yaml')]
const compose = spawn('docker', [...composeArgs, 'up', '--build', '--abort-on-container-exit'], {
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
if (process.argv.includes('--app')) {
  try {
    console.info('Waiting for Bridge readiness before starting the frontend…')
    while (!stopping) {
      try {
        const response = await fetch('http://127.0.0.1:4682/api/v1/ceremony/config', {
          headers: { Origin: 'http://localhost:4691' },
          redirect: 'error',
          signal: AbortSignal.timeout(1000),
        })
        await response.body?.cancel()
        if (response.status === 200) break
      } catch {
        /* Compose may still be building or starting the Bridge. */
      }
      await delay(500)
    }
    if (!stopping) {
      frontend = await createViteServer({ configFile: join(root, 'vite.config.ts') })
      if (stopping) await frontend.close()
      else {
        await frontend.listen()
        frontend.printUrls()
      }
    }
  } catch {
    if (!stopping) {
      console.error('Could not start the development frontend.')
      stop(1)
    }
  }
}
