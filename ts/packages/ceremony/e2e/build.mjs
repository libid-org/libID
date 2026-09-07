import { build } from 'vite'
import { join } from 'node:path'
import { packageDir } from '../build/release.mjs'
for (const [entry, name] of [
  ['e2e/app.ts', 'app.js'],
  ['src/ui.ts', 'ui.js'],
  ['../popup/src/index.ts', 'popup.js'],
])
  await build({
    configFile: false,
    root: packageDir,
    logLevel: 'warn',
    build: {
      outDir: join(packageDir, '.cache/e2e'),
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: { entry: join(packageDir, entry), formats: ['es'], fileName: () => name },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
