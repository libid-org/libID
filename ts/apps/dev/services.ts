// Start the real Bridge, notary and emitted CCDP; no OAuth mocks.
// LIBID_STACK_LOGS names a file that takes every child's output, containers
// included, appended; a relative path resolves as paths.ts says.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { openSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { APP_ORIGIN, BRIDGE, NOTARY } from './local.ts'
import { settingPath } from './paths.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
// Distinct Compose ownership for each checkout. No shared container names.
const project = `libid-dev-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
const composeArgs = ['compose', '-p', project, '-f', join(root, 'compose.yaml')]
// --project: print this checkout's Compose project, for a cleanup to stop it.
if (process.argv.includes('--project')) {
  console.info(project)
  process.exit(0)
}
const logPath = settingPath((name) => process.env[name], process.env.LIBID_STACK_LOGS)
const logs = logPath ? openSync(logPath, 'a') : undefined
const stdio =
  logs === undefined ? 'inherit' : (['ignore', logs, logs] as ['ignore', number, number])
/** Whether something on this host accepts connections on `port`. */
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: '127.0.0.1', timeout: 1000 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
// Refuse to start beside another stack on compose.yaml's ports: readiness could pass against it.
if (!process.argv.includes('--ccdp')) {
  let ports: number[]
  let own: string
  try {
    own = execFileSync('docker', [...composeArgs, 'ps', '-q'], { encoding: 'utf8' }).trim()
    const config = JSON.parse(
      execFileSync('docker', [...composeArgs, 'config', '--format', 'json'], { encoding: 'utf8' }),
    ) as { services: Record<string, { ports?: { published?: string }[] }> }
    // A range or an unpublished port is no single port to probe.
    ports = Object.values(config.services).flatMap((service) =>
      (service.ports ?? []).flatMap(({ published }) =>
        published && /^\d+$/.test(published) ? [Number(published)] : [],
      ),
    )
  } catch {
    console.error('Could not run Docker Compose. Install Docker with Compose and start its engine.')
    process.exit(1)
  }
  // Which service answers on each is checked once the stack is up.
  for (const [name, origin] of Object.entries({ BRIDGE, NOTARY })) {
    const port = Number(new URL(origin).port)
    if (!ports.includes(port)) {
      console.error(`local.ts's ${name} port ${port} is not one compose.yaml publishes.`)
      process.exit(1)
    }
  }
  const open = await Promise.all(ports.map(listening))
  const taken = ports.filter((_, index) => open[index])
  if (taken.length && own) {
    console.error(
      `This checkout's stack already runs (Compose project ${project}): stop that \`pnpm dev\`, or run \`docker compose -p ${project} down\`.`,
    )
    process.exit(1)
  }
  if (taken.length) {
    console.error(
      `Already in use on 127.0.0.1: port ${taken.join(', ')}. Stop what holds it (see docker ps) and retry.`,
    )
    process.exit(1)
  }
}
// Rebuild the shared distribution; immutable assets reuse the build cache.
execFileSync(
  'pnpm',
  ['--filter', '@libid/ceremony', 'build:ccdp-artifacts', '--out-dir', join(root, '.cache/ccdp')],
  {
    cwd: root,
    stdio,
  },
)
// Refresh the bind mounts after the build atomically replaces its output directory.
if (process.argv.includes('--ccdp')) {
  execFileSync(
    'docker',
    [...composeArgs, 'up', '--wait', '--no-deps', '--no-build', '--force-recreate', 'ccdp'],
    {
      stdio,
    },
  )
  process.exit(0)
}
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
  const down = spawn('docker', [...composeArgs, 'down'], { stdio })
  down.on('error', () => console.error('Could not stop development containers. Check Docker.'))
  down.on('close', (code) => {
    if (code !== 0) process.exitCode = 1
  })
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
const compose = spawn('docker', [...composeArgs, 'up', '--abort-on-container-failure'], {
  stdio,
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
        // Docker publishes on 127.0.0.1 only.
        const response = await fetch(
          new URL('/api/v1/ceremony/config', BRIDGE.replace('localhost', '127.0.0.1')),
          {
            headers: { Origin: APP_ORIGIN },
            redirect: 'error',
            signal: AbortSignal.timeout(1000),
          },
        )
        await response.body?.cancel()
        if (response.status === 200) break
      } catch {
        /* Compose may still be pulling or starting the Bridge. */
      }
      await delay(500)
    }
    // Readiness above proves BRIDGE is the Bridge; only the notary serves /healthcheck.
    if (!stopping) {
      const notary = await fetch(
        new URL('/healthcheck', NOTARY.replace('localhost', '127.0.0.1')),
        {
          signal: AbortSignal.timeout(2000),
        },
      )
        .then(async (response) => {
          await response.body?.cancel()
          return response.status
        })
        .catch(() => 0)
      if (notary !== 200) {
        console.error(
          `local.ts's NOTARY ${NOTARY} does not answer as the notary (GET /healthcheck).`,
        )
        stop(1)
      }
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
