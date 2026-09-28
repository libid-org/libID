// Bundle the two entries the e2e pages load as single-file ES modules:
// the package for documents and the worker entry as the Service Worker
// script. Nothing here is published; it exists so real browsers run the
// exact source under test.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(packageDir, 'e2e', 'dist')

const bundle = (entry, fileName, emptyOutDir) =>
  build({
    configFile: false,
    logLevel: 'warn',
    root: packageDir,
    build: {
      outDir,
      emptyOutDir,
      target: 'es2022',
      minify: false,
      lib: { entry: join(packageDir, entry), formats: ['es'], fileName: () => fileName },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })

await bundle('src/index.ts', 'popup.js', true)
await bundle('e2e/sw-entry.ts', 'sw.js', false)
