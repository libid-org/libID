import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const directory = join(root, '.cache/dev')
export default defineConfig({
  root: join(root, 'src'),
  cacheDir: join(directory, 'vite'),
  envPrefix: [],
  server: {
    host: 'localhost',
    port: 4691,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.cache/**'] },
  },
  build: { outDir: join(directory, 'app'), emptyOutDir: true },
})
