import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { localhostTls } from './tls.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
test('first startup sets up mkcert; later sessions reuse bytes until expiry', async () => {
  const { execFileSync: openssl } =
    await vi.importActual<typeof import('node:child_process')>('node:child_process')
  mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true })
  const directory = mkdtempSync(fileURLToPath(new URL('../.cache/dev-tls-test-', import.meta.url)))
  try {
    const cert = join(directory, 'localhost.pem'),
      key = join(directory, 'localhost-key.pem')
    const calls: string[][] = []
    vi.mocked(execFileSync).mockImplementation((_file, args) => {
      const arguments_ = args as string[]
      calls.push(arguments_)
      if (arguments_[0] === '-cert-file')
        openssl(
          'openssl',
          [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
            '-keyout',
            key,
            '-out',
            cert,
          ],
          { stdio: 'ignore' },
        )
      return Buffer.alloc(0)
    })
    const first = localhostTls(directory)
    expect(calls.map((a) => a[0])).toEqual(['-version', '-install', '-cert-file'])
    expect(calls[2].slice(-3)).toEqual(['localhost', '127.0.0.1', '::1'])
    expect(localhostTls(directory)).toEqual(first)
    expect(calls).toHaveLength(3)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2 * 86400000)
    localhostTls(directory)
    expect(calls).toHaveLength(6)
    expect(readFileSync(cert)).not.toEqual(first.cert)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
