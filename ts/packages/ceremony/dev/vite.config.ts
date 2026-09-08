import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { makeCertificate } from '../e2e/tls.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, 'CEREMONY_'), ...process.env }
  const directory = join(root, '../.cache/dev')
  mkdirSync(directory, { recursive: true })
  if (!!env.CEREMONY_TLS_CERT !== !!env.CEREMONY_TLS_KEY)
    throw new Error('Set both CEREMONY_TLS_CERT and CEREMONY_TLS_KEY')
  const cert = env.CEREMONY_TLS_CERT ?? join(directory, 'cert.pem')
  const key = env.CEREMONY_TLS_KEY ?? join(directory, 'key.pem')
  if (!env.CEREMONY_TLS_CERT && (!existsSync(cert) || !existsSync(key))) {
    const generated = makeCertificate(['localhost'], 365)
    writeFileSync(cert, generated.cert)
    writeFileSync(key, generated.key, { mode: 0o600 })
  }
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
      https: { cert: readFileSync(cert), key: readFileSync(key) },
    },
    build: { outDir: join(directory, 'app'), emptyOutDir: true },
  }
})
