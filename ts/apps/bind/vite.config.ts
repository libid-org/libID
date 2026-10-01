import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const directory = join(root, '.cache/bind')
export default defineConfig({
  root: join(root, 'src'),
  cacheDir: join(directory, 'vite'),
  envDir: root,
  server: {
    host: 'localhost',
    port: 4695,
    strictPort: true,
    // The indexer's read API, same-origin so the page needs no CORS from it.
    proxy: {
      '/indexer': {
        target: 'http://127.0.0.1:4689',
        rewrite: (path) => path.replace(/^\/indexer/, ''),
      },
    },
  },
  build: { outDir: join(directory, 'app'), emptyOutDir: true },
})
