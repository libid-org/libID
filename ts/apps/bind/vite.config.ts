import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { API, APP_PORT } from './local.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const directory = join(root, '.cache/bind')
export default defineConfig({
  root: join(root, 'src'),
  cacheDir: join(directory, 'vite'),
  envDir: root,
  server: {
    host: 'localhost',
    port: APP_PORT,
    strictPort: true,
    // The indexer's read API, same-origin so the page needs no CORS from it.
    proxy: {
      '/indexer': {
        target: API,
        rewrite: (path) => path.replace(/^\/indexer/, ''),
      },
    },
  },
  build: { outDir: join(directory, 'app'), emptyOutDir: true },
})
