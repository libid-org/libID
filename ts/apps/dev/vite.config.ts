import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { localhostTls } from './tls.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig(({ command }) => {
  const directory = join(root, '.cache/dev')
  mkdirSync(directory, { recursive: true })
  return {
    root: join(root, 'src'),
    cacheDir: join(directory, 'vite'),
    envPrefix: [],
    server: {
      host: 'localhost',
      port: 4691,
      strictPort: true,
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cache/**'] },
      https: command === 'serve' ? localhostTls(directory) : undefined,
    },
    build: { outDir: join(directory, 'app'), emptyOutDir: true },
  }
})
