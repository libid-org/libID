import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const directory = join(root, '.cache/dev')
export default defineConfig({
  root: join(root, 'src'),
  cacheDir: join(directory, 'vite'),
  server: {
    host: 'localhost',
    port: 4691,
    strictPort: true,
  },
  build: { outDir: join(directory, 'app'), emptyOutDir: true },
})
