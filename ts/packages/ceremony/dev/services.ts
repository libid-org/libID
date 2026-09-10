// Local HTTPS ingress for the real Bridge and emitted CCDP; no OAuth mocks.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer, type Server } from 'node:https'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { localhostTls } from './tls.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...loadEnv('development', join(root, 'dev'), ''), ...process.env }
const cache = join(root, '.cache/dev')
const artifact = join(root, '.cache/qualification-assets')
const bridgeBinary = env.CEREMONY_BRIDGE_BINARY
const swsBinary = env.CEREMONY_SWS_BINARY
if (!bridgeBinary || !swsBinary)
  throw new Error(
    'Set CEREMONY_BRIDGE_BINARY and CEREMONY_SWS_BINARY to the pinned local binaries.',
  )
const platforms =
  env.CEREMONY_PLATFORMS ?? readFileSync(join(root, 'dev/oauth-clients.json'), 'utf8')
if (!existsSync(join(artifact, 'public/ccdp/callback.html')))
  throw new Error('Run build:qualification-artifacts first.')
mkdirSync(cache, { recursive: true })
if (!!env.CEREMONY_TLS_CERT !== !!env.CEREMONY_TLS_KEY)
  throw new Error('Set both CEREMONY_TLS_CERT and CEREMONY_TLS_KEY')
const tls = env.CEREMONY_TLS_CERT
  ? { cert: readFileSync(env.CEREMONY_TLS_CERT), key: readFileSync(env.CEREMONY_TLS_KEY!) }
  : localhostTls(cache)
// These ports match dev/.env.example. Private listeners never leave loopback.
const config = readFileSync(join(artifact, 'sws.toml'), 'utf8')
  .replaceAll('/home/sws/public', join(artifact, 'public'))
  .replace('host = "::"', 'host = "127.0.0.1"')
  .replace('port = 8787', 'port = 4684')
writeFileSync(join(cache, 'sws.toml'), config)
const children: ChildProcess[] = []
const servers: Server[] = []
let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const server of servers) {
    server.close()
    server.closeAllConnections()
  }
  for (const child of children) child.kill('SIGTERM')
}
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
function start(binary: string, args: string[], childEnv: NodeJS.ProcessEnv) {
  const child = spawn(binary, args, { env: childEnv, stdio: 'inherit' })
  children.push(child)
  child.on('error', () => {
    console.error('Could not start a development service.')
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1)
  })
}
const { GH_OAUTH_CLIENT_SECRET: _secret, ...publicEnv } = process.env
start(swsBinary, ['--config-file', join(cache, 'sws.toml')], publicEnv)
start(bridgeBinary, [], {
  ...publicEnv,
  HOST: '127.0.0.1',
  PORT: '4685',
  BASE_URL: 'https://localhost:4682',
  CALLBACK_PATH: '/auth/callback',
  CCDP_ORIGIN: 'https://localhost:4683',
  ALLOWED_APP_ORIGINS: 'https://localhost:4691',
  CALLBACK_ARTIFACT_PATH: join(artifact, 'public/ccdp/callback.html'),
  CEREMONY_PLATFORMS: platforms,
  GH_OAUTH_CLIENT_SECRET: env.GH_OAUTH_CLIENT_SECRET ?? '',
  NOTARY_URL: env.NOTARY_URL ?? 'tcp://127.0.0.1:7047',
})
for (const [port, upstream] of [
  [4682, 4685],
  [4683, 4684],
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
  servers.push(server)
  server.on('error', () => {
    console.error(`Development HTTPS port ${port} unavailable.`)
    stop(1)
  })
  server.listen(port, 'localhost', () =>
    console.info(`Development service: https://localhost:${port}`),
  )
}
