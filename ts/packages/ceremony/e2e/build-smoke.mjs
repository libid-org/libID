import { build } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageDir } from '../build/release.ts'
import { resolveAssets, assetPlugin } from '../build/assets.ts'
const outDir = join(packageDir, '.cache/smoke')
mkdirSync(outDir, { recursive: true })
const assets = await resolveAssets(outDir)
const diagnostics = {
  name: 'smoke-diagnostics',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/engine.ts'))
      return code.replace(
        '#onMessage(message: WorkerMessage): void {',
        "#onMessage(message: WorkerMessage): void { console.info('SMOKE engine',message.type,'code' in message?message.code:'')",
      )
    if (id.endsWith('/session.worker.ts'))
      return code
        .replace('await tlsn.default', "console.info('SMOKE notary load');await tlsn.default")
        .replace(
          'await tlsn.initialize',
          "console.info('SMOKE notary initialize');await tlsn.initialize",
        )
        .replace('const socket=new', "console.info('SMOKE notary connect');const socket=new")
        .replace(
          'await prover.setup(io)',
          "console.info('SMOKE notary setup');await prover.setup(io);console.info('SMOKE notary prepared')",
        )
  },
}
await build({
  configFile: false,
  root: packageDir,
  base: '/',
  plugins: [assetPlugin(assets), diagnostics],
  worker: { format: 'es', plugins: () => [assetPlugin(assets), diagnostics] },
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: join(packageDir, 'e2e/smoke.ts'),
      output: {
        entryFileNames: 'smoke.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
})
writeFileSync(
  join(outDir, 'index.html'),
  '<!doctype html><title>Ceremony engine qualification</title><script type="module" src="/smoke.js"></script>',
)
