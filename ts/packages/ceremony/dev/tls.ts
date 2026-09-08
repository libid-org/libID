import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** mkcert's CA is shared by the machine; this worktree keeps its issued certificate. */
export function localhostTls(directory: string) {
  const cert = join(directory, 'localhost.pem')
  const key = join(directory, 'localhost-key.pem')
  const current =
    existsSync(cert) &&
    existsSync(key) &&
    Date.parse(new X509Certificate(readFileSync(cert)).validTo) > Date.now()
  if (!current) {
    try {
      execFileSync('mkcert', ['-version'], { stdio: 'ignore' })
    } catch {
      throw new Error(
        'Install mkcert first (brew install mkcert on macOS/Linux Homebrew), then rerun pnpm dev.',
      )
    }
    console.info(
      'Setting up trusted localhost HTTPS. mkcert may request your administrator password.',
    )
    execFileSync('mkcert', ['-install'], { stdio: 'inherit' })
    execFileSync(
      'mkcert',
      ['-cert-file', cert, '-key-file', key, 'localhost', '127.0.0.1', '::1'],
      { stdio: 'inherit' },
    )
    console.info(
      'Certificate saved for future dev sessions. Restart your browser once if it still reports a certificate warning.',
    )
  }
  return { cert: readFileSync(cert), key: readFileSync(key) }
}
