import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { APP_ORIGIN } from './local.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const directory = join(root, '.cache/dev')
export default defineConfig({
  root: join(root, 'src'),
  cacheDir: join(directory, 'vite'),
  server: {
    host: 'localhost',
    port: Number(new URL(APP_ORIGIN).port),
    strictPort: true,
  },
  build: { outDir: join(directory, 'app'), emptyOutDir: true },
})
