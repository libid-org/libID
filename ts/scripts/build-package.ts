import { execFileSync } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'

// Only the entry points in tsconfig.build.json and their dependencies enter the tarball.
rmSync('dist', { recursive: true, force: true })
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' })
for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']) {
  copyFileSync(new URL(`../../${name}`, import.meta.url), name)
}
