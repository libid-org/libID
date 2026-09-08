// Per-run self-signed certificate covering every e2e hostname, so the
// multi-origin topology is genuinely cross-origin over HTTPS (the only way
// COOP and opener severing behave realistically). Playwright runs with
// ignoreHTTPSErrors; nothing here is a production artifact.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function makeCertificate(hostnames, days = 2) {
  mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true })
  const dir = mkdtempSync(new URL('../.cache/tls-', import.meta.url))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  const sans = hostnames.map((h) => `DNS:${h}`).join(',')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      String(days),
      '-subj',
      '/CN=popup-e2e',
      '-addext',
      `subjectAltName=${sans}`,
    ],
    { stdio: 'ignore' },
  )
  return { key: readFileSync(key), cert: readFileSync(cert) }
}
