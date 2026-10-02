import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const output = join(workspace, '.cache/npm')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
const packages = ['ledger', 'popup', 'ceremony']
const dependencies: Record<string, string> = {}
for (const name of packages) {
  const archive = join(output, `${name}.tgz`)
  execFileSync('pnpm', ['pack', '--out', archive], {
    cwd: join(workspace, 'packages', name),
    stdio: 'inherit',
  })
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
  for (const file of files) {
    assert.match(
      file,
      /^package\/(?:package\.json|README\.md|LICENSE-MIT|LICENSE-APACHE|NOTICE|dist\/.+\.(?:js|js\.map|d\.ts))$/,
      `Unexpected published file: ${name}/${file}`,
    )
    assert.doesNotMatch(file, /\.test\./)
  }
  for (const file of ['README.md', 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']) {
    assert(files.includes(`package/${file}`), `${name} is missing ${file}`)
  }
  dependencies[`@libid/${name}`] = `file:${archive}`
}

// npm installs real copies, not workspace links. The fixture lives outside ts/ so its
// imports cannot fall back to the workspace's node_modules. Keep its cache local too.
const consumer = fileURLToPath(new URL('../../.ceremony-local/npm-consumer', import.meta.url))
rmSync(consumer, { recursive: true, force: true })
mkdirSync(consumer, { recursive: true })
const require = createRequire(new URL('../packages/ceremony/package.json', import.meta.url))
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies,
    devDependencies: {
      typescript: require('typescript/package.json').version,
      vite: require('vite/package.json').version,
    },
  }),
)
execFileSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--cache',
    join(output, 'npm-cache'),
  ],
  { cwd: consumer, stdio: 'inherit' },
)
writeFileSync(
  join(consumer, 'client.ts'),
  `export * from '@libid/ceremony'
export * from '@libid/popup'
export { fakeConnection } from '@libid/popup/testing'
export type { LedgerId } from '@libid/ledger'
`,
)
writeFileSync(
  join(consumer, 'worker.ts'),
  "export { installPortKeeper } from '@libid/popup/worker'\n",
)
for (const [entry, lib] of [
  ['client', 'DOM'],
  ['worker', 'WebWorker'],
]) {
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', lib],
        types: [],
      },
      files: [`${entry}.ts`],
    }),
  )
  execFileSync('node', ['node_modules/typescript/bin/tsc'], { cwd: consumer, stdio: 'inherit' })
}
writeFileSync(
  join(consumer, 'vite.config.js'),
  `export default { build: { lib: { entry: ['client.ts', 'worker.ts'], formats: ['es'] } } }\n`,
)
execFileSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: consumer,
  stdio: 'inherit',
})

// pnpm must replace workspace ranges with registry versions, including the peer.
for (const name of packages) {
  const manifest = readFileSync(join(consumer, 'node_modules/@libid', name, 'package.json'), 'utf8')
  assert.doesNotMatch(manifest, /workspace:|catalog:/)
}
console.log(`Checked tarballs: ${output}`)
