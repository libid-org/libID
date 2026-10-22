// scan-secrets.ts run as CI runs it, against logs holding fake markers.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const SCRIPT = new URL('./scan-secrets.ts', import.meta.url).pathname
const directory = mkdtempSync(join(tmpdir(), 'scan-secrets-'))
after(() => rmSync(directory, { recursive: true, force: true }))
const base64 = (text: string) => Buffer.from(text).toString('base64')

/** The scan's exit code for a log holding `log`, with `env` as the step's settings. */
function scan(log: string, env: Record<string, string>): number | null {
  const file = join(directory, `${Math.random().toString(36).slice(2)}.log`)
  writeFileSync(file, log)
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/_TEST_ALICE_|^LIBID_|^CI$/.test(name)),
  )
  return spawnSync(process.execPath, [SCRIPT, file], { env: { ...clean, ...env } }).status
}

const storageState = base64(
  JSON.stringify({
    cookies: [{ name: 'SID', value: 'FAKE/MARKER=123', domain: '.google.com' }],
    origins: [
      {
        origin: 'https://accounts.google.com',
        localStorage: [{ name: 'k', value: 'LSVALUE-98765' }],
      },
    ],
  }),
)

test('a secret in the log fails the scan, in each form it is looked for', () => {
  const password = { GH_TEST_ALICE_PASSWORD: 'FAKE"QUOTE-12345' }
  assert.equal(scan('x FAKE"QUOTE-12345 y', password), 1)
  assert.equal(scan('x FAKE\\"QUOTE-12345 y', password), 1)
  assert.equal(scan('x FAKE%22QUOTE-12345 y', password), 1)
  const google = { GOOGLE_TEST_ALICE_COOKIES: storageState }
  assert.equal(scan('x FAKE%2FMARKER%3D123 y', google), 1)
  assert.equal(scan('x LSVALUE-98765 y', google), 1)
  assert.equal(scan(`x ${storageState} y`, google), 1)
})

test('an undecodable session is still looked for by its value strings', () => {
  const truncated = base64('[{"name":"auth_token","value":"FAKEMARKER-123456"')
  assert.equal(scan('x FAKEMARKER-123456 y', { X_TEST_ALICE_COOKIES: truncated }), 1)
  assert.equal(scan('clean', { X_TEST_ALICE_COOKIES: '!!!not base64' }), 0)
})

test('values under 8 characters are not looked for; a clean log passes', () => {
  assert.equal(scan('x SHORT-7 y', { GH_TEST_ALICE_PASSWORD: 'SHORT-7' }), 0)
  assert.equal(scan('clean', { GH_TEST_ALICE_PASSWORD: 'FAKE-PASSWORD-1' }), 0)
})

test('under CI, a scan with no secret to look for fails', () => {
  assert.equal(scan('clean', { CI: 'true' }), 1)
  assert.equal(scan('clean', {}), 0)
})
