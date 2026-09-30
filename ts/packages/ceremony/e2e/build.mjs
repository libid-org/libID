import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'vite'
import { packageDir } from '../build/sources.ts'

// Every e2e input, before Playwright starts the containers that mount the first two.
execFileSync(
  process.execPath,
  ['build/distribution.ts', '--out-dir', '.cache/qualification-assets'],
  { cwd: packageDir, stdio: 'inherit' },
)
await import('./buildRuntime.mjs')
await (await import('./crs.mjs')).cacheCrs()

/** An unminified ES library build into the directory the harness server reads. */
const buildHarness = (lib, options) =>
  build({
    configFile: false,
    root: packageDir,
    logLevel: 'warn',
    build: {
      outDir: join(packageDir, '.cache/e2e'),
      minify: false,
      target: 'es2022',
      lib: { formats: ['es'], ...lib },
      ...options,
    },
  })

// One build, so the harness modules share their dependencies instead of each inlining a copy.
await buildHarness(
  {
    entry: {
      app: join(packageDir, 'e2e/app.ts'),
      ui: join(packageDir, 'src/ccdp/documents/ui.ts'),
      events: join(packageDir, 'src/events.ts'),
      'google-events': join(packageDir, 'src/platforms/google/1/events.ts'),
      popup: createRequire(import.meta.url).resolve('@libid/popup'),
    },
    fileName: (_, name) => `${name}.js`,
  },
  { emptyOutDir: true },
)

// Served in place of the released TLSN SDK module, so it cannot import harness chunks.
await buildHarness(
  { entry: join(packageDir, 'e2e/tlsn.fixture.ts'), fileName: () => 'tlsn-fixture.js' },
  { emptyOutDir: false, rollupOptions: { output: { inlineDynamicImports: true } } },
)
