import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { localhostTls } from './tls.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, root, 'CEREMONY_'), ...process.env }
  const directory = join(root, '../.cache/dev')
  mkdirSync(directory, { recursive: true })
  if (!!env.CEREMONY_TLS_CERT !== !!env.CEREMONY_TLS_KEY)
    throw new Error('Set both CEREMONY_TLS_CERT and CEREMONY_TLS_KEY')
  const https =
    command !== 'serve'
      ? undefined
      : env.CEREMONY_TLS_CERT
        ? { cert: readFileSync(env.CEREMONY_TLS_CERT), key: readFileSync(env.CEREMONY_TLS_KEY!) }
        : localhostTls(directory)
  const origin = (value: string) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value)
      throw new Error('Bridge and CCDP must be canonical HTTPS origins')
    return value
  }
  return {
    root,
    cacheDir: join(directory, 'vite'),
    envPrefix: [],
    define: {
      __CEREMONY_DEV__: JSON.stringify({
        bridge: origin(env.CEREMONY_BRIDGE_ORIGIN ?? 'https://localhost:4682'),
        ccdp: origin(env.CEREMONY_CCDP_ORIGIN ?? 'https://localhost:4683'),
      }),
    },
    resolve: {
      alias: {
        '@libid/ceremony/client': join(root, '../src/client/index.ts'),
        '@libid/ledger': join(root, '../../ledger/src/testing.ts'),
      },
    },
    server: {
      host: 'localhost',
      port: Number(env.CEREMONY_APP_PORT ?? 4691),
      strictPort: true,
      https,
    },
    build: { outDir: join(directory, 'app'), emptyOutDir: true },
  }
})
