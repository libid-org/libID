import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const output = join(workspace, '.cache/npm')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
// Dependencies first: packing builds each package against its dependencies' declarations.
const packages = ['ledger', 'popup', 'ceremony']
// Every package that is not private is releasable, so each must be checked here. A directory
// without a manifest is not a package.
const releasable = readdirSync(join(workspace, 'packages')).filter((name) => {
  const manifest = join(workspace, 'packages', name, 'package.json')
  return existsSync(manifest) && !JSON.parse(readFileSync(manifest, 'utf8')).private
})
assert.deepEqual(releasable.sort(), [...packages].sort(), 'packages must list every public package')
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
  // Every export target ships, including runtime ones the consumer imports only as types.
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }),
  )
  const targets = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(targets)
  for (const target of targets(manifest.exports)) {
    assert(files.includes(`package/${target.slice(2)}`), `${name} exports missing ${target}`)
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
  {
    cwd: consumer,
    stdio: 'inherit',
    // pnpm's npm_config_* settings are not npm's; npm warns on them and will reject them.
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
    ),
  },
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
