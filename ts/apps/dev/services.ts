// Local HTTPS ingress for the real Bridge and emitted CCDP; no OAuth mocks.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { mkdirSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer, type Server } from 'node:https'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createViteServer, loadEnv, type ViteDevServer } from 'vite'
import { localhostTls } from './tls.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const env = { ...loadEnv('development', root, ''), ...process.env }
const cache = join(root, '.cache/dev')
const platforms = env.CEREMONY_PLATFORMS ?? readFileSync(join(root, 'oauth-clients.json'), 'utf8')
const { GH_OAUTH_CLIENT_SECRET: _secret, ...publicEnv } = process.env
// Always rebuild against the local notary; immutable assets reuse the build cache.
execFileSync(
  'pnpm',
  ['--filter', '@libid/ceremony', 'build:ccdp-artifacts', '--out-dir', join(root, '.cache/ccdp')],
  {
    cwd: root,
    env: {
      ...publicEnv,
      LIBID_LEDGER_FIXTURE: '1',
      LIBID_NOTARY_ADDRESS: 'https://localhost:4687',
    },
    stdio: 'inherit',
  },
)
mkdirSync(cache, { recursive: true })
if (!!env.CEREMONY_TLS_CERT !== !!env.CEREMONY_TLS_KEY)
  throw new Error('Set both CEREMONY_TLS_CERT and CEREMONY_TLS_KEY')
const tls = env.CEREMONY_TLS_CERT
  ? { cert: readFileSync(env.CEREMONY_TLS_CERT), key: readFileSync(env.CEREMONY_TLS_KEY!) }
  : localhostTls(cache)
let frontend: ViteDevServer | undefined
const servers: Server[] = []
const sockets = new Set<Duplex>()
let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  void frontend?.close()
  for (const server of servers) {
    server.close()
    server.closeAllConnections()
  }
  for (const socket of sockets) socket.destroy()
  // Stop the producer before teardown; CLI plugins share this owned process group.
  if (compose.pid) {
    try {
      process.kill(-compose.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  // Keep this child alive through completion, including after a partial startup.
  const down = spawn('docker', [...composeArgs, 'down'], { env: composeEnv, stdio: 'inherit' })
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
const composeEnv = {
  ...publicEnv,
  CEREMONY_PLATFORMS: platforms,
  GH_OAUTH_CLIENT_SECRET: env.GH_OAUTH_CLIENT_SECRET ?? '',
}
const compose = spawn('docker', [...composeArgs, 'up', '--build', '--abort-on-container-exit'], {
  env: composeEnv,
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
for (const [port, upstream] of [
  [4682, 4685],
  [4683, 4684],
  [4687, 4688],
]) {
  const server = createServer(tls, (req, res) => {
    const proxy = request(
      {
        hostname: '127.0.0.1',
        port: upstream,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers)
        reply.pipe(res)
      },
    )
    // Never log URLs, request headers, bodies or provider errors.
    proxy.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end('Service unavailable')
    })
    res.on('close', () => proxy.destroy())
    req.pipe(proxy)
  })
  // Node forwards the HTTP upgrade unchanged; TLSNotary owns the binary protocol.
  if (port === 4687)
    server.on('upgrade', (req, socket, head) => {
      const proxy = request({
        hostname: '127.0.0.1',
        port: upstream,
        path: req.url,
        method: req.method,
        headers: req.headers,
      })
      proxy.on('error', () => socket.destroy())
      proxy.on('response', (reply) => {
        reply.resume()
        socket.destroy()
      })
      socket.on('error', () => socket.destroy())
      socket.on('close', () => proxy.destroy())
      proxy.on('upgrade', (reply, upstreamSocket, upstreamHead) => {
        upstreamSocket.on('error', () => socket.destroy())
        socket.on('close', () => upstreamSocket.destroy())
        upstreamSocket.on('close', () => socket.destroy())
        socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`)
        for (let i = 0; i < reply.rawHeaders.length; i += 2)
          socket.write(`${reply.rawHeaders[i]}: ${reply.rawHeaders[i + 1]}\r\n`)
        socket.write('\r\n')
        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        socket.pipe(upstreamSocket).pipe(socket)
      })
      proxy.end()
    })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  servers.push(server)
  server.on('error', () => {
    console.error(`Development HTTPS port ${port} unavailable.`)
    stop(1)
  })
  server.listen(port, 'localhost', () =>
    console.info(`Development service: https://localhost:${port}`),
  )
}

if (process.argv.includes('--app')) {
  try {
    console.info('Waiting for Bridge readiness before starting the frontend…')
    while (!stopping) {
      try {
        const response = await fetch('http://127.0.0.1:4685/api/v1/ceremony/config', {
          headers: { Origin: 'https://localhost:4691' },
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
