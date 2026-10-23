// scan-secrets.ts run as CI runs it, against logs holding fake markers.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SCANNED } from './settings.ts'

const SCRIPT = fileURLToPath(new URL('./scan-secrets.ts', import.meta.url))
const FOUND = 2
const NOTHING_TO_LOOK_FOR = 3
const directory = mkdtempSync(join(tmpdir(), 'scan-secrets-'))
after(() => rmSync(directory, { recursive: true, force: true }))
const base64 = (text: string) => Buffer.from(text).toString('base64')

/** A file in the test's directory holding `text`. */
function file(text: string): string {
  const path = join(directory, Math.random().toString(36).slice(2))
  writeFileSync(path, text)
  return path
}

/** The scan's exit code for a log holding `log`, with `env` as the step's settings. */
function scan(log: string, env: Record<string, string>): number | null {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/_TEST_ALICE_|^LIBID_|^CI$/.test(name)),
  )
  const run = spawnSync(process.execPath, [SCRIPT, file(log)], {
    env: { ...clean, ...env },
    encoding: 'utf8',
  })
  if (run.status === FOUND) assert.match(run.stderr, /^Secrets in: /)
  return run.status
}

const cookies = (value: string) => JSON.stringify([{ name: 'SID', value, domain: '.google.com' }])
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

test('the scan looks for exactly the SCANNED variables', () => {
  for (const name of SCANNED) {
    const env = name.endsWith('_COOKIES_FILE')
      ? { [name]: file(cookies(`MARKER-${name}`)) }
      : name.endsWith('_COOKIES')
        ? { [name]: base64(cookies(`MARKER-${name}`)) }
        : { [name]: `MARKER-${name}` }
    assert.equal(scan(`x MARKER-${name} y`, env), FOUND, name)
  }
  assert.equal(scan('x MARKER-USERNAME y', { GH_TEST_ALICE_USERNAME: 'MARKER-USERNAME' }), 0)
})

test('a secret in the log fails the scan, in each form it is looked for', () => {
  const password = { GH_TEST_ALICE_PASSWORD: 'FAKE"QUOTE-12345' }
  assert.equal(scan('x FAKE"QUOTE-12345 y', password), FOUND)
  assert.equal(scan('x FAKE\\"QUOTE-12345 y', password), FOUND)
  assert.equal(scan('x FAKE%22QUOTE-12345 y', password), FOUND)
  const google = { GOOGLE_TEST_ALICE_COOKIES: storageState }
  assert.equal(scan('x FAKE%2FMARKER%3D123 y', google), FOUND)
  assert.equal(scan('x LSVALUE-98765 y', google), FOUND)
  assert.equal(scan(`x ${storageState} y`, google), FOUND)
  const capitalised = base64('[{"Name":"SID","Value":"CAPITAL-VALUE-1","Domain":".google.com"}]')
  assert.equal(scan('x CAPITAL-VALUE-1 y', { GOOGLE_TEST_ALICE_COOKIES: capitalised }), FOUND)
})

test('an undecodable session is still looked for by its value strings', () => {
  const truncated = base64('[{"Name":"auth_token","Value":"FAKEMARKER-123456"')
  assert.equal(scan('x FAKEMARKER-123456 y', { X_TEST_ALICE_COOKIES: truncated }), FOUND)
  const badEntry = base64('[{"name":"a","value":"BADENTRY-123456","domain":1}]')
  assert.equal(scan('x BADENTRY-123456 y', { X_TEST_ALICE_COOKIES: badEntry }), FOUND)
  assert.equal(scan('clean', { X_TEST_ALICE_COOKIES: '!!!not base64' }), 0)
})

test('values under 8 characters are not looked for; a clean log passes', () => {
  assert.equal(scan('x SHORT-7 y', { GH_TEST_ALICE_PASSWORD: 'SHORT-7' }), 0)
  assert.equal(scan('clean', { GH_TEST_ALICE_PASSWORD: 'FAKE-PASSWORD-1' }), 0)
})

test('under CI, a scan with no secret to look for fails', () => {
  assert.equal(scan('clean', { CI: 'true' }), NOTHING_TO_LOOK_FOR)
  assert.equal(scan('clean', {}), 0)
})
