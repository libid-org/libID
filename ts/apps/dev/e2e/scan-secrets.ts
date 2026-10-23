// Refuse to publish a failed run's stack log when it holds a test secret: the
// value of each variable settings.ts' SCANNED lists, and for a saved session
// every value it holds (its cookies' and, for a storage state, its origins'
// localStorage values), each also URL-encoded and JSON-escaped. A session
// that does not decode is still looked for as set. Paths are the arguments; a
// missing file is skipped. Settings come from the environment and the file
// LIBID_TEST_ENV_FILE names, as settings.ts reads them. Exit 2: a secret was
// found; 3: under CI, there was none to look for; 4: a *_COOKIES_FILE could
// not be read. Nothing secret is printed.
import { existsSync, readFileSync } from 'node:fs'
import { settingPath } from '../paths.ts'
import { exportCookies } from './session.ts'
import { envFile, loadEnvFile, SCANNED, tooling } from './settings.ts'

const settingsFile = envFile()
if (settingsFile) loadEnvFile(settingsFile)

const environment = (name: string) => process.env[name]

/** The `value` strings of `items`, where it is a list. */
const values = (items: unknown) =>
  Array.isArray(items) ? items.map((item) => (item as { value?: unknown } | null)?.value) : []

/** Every `"value": "…"` string `text` holds, in any spelling of the key. */
const valueStrings = (text: string) =>
  [...text.matchAll(/"value"\s*:\s*"([^"\\]*)"/gi)].map((match) => match[1])

/**
 * The values a session export holds: its cookies' and its origins'
 * localStorage; where it is not JSON or no cookie list, its value strings.
 */
function heldValues(text: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return valueStrings(text)
  }
  const cookies = exportCookies(parsed)
  const origins = (parsed as { origins?: unknown } | null)?.origins
  return [
    ...(cookies ? cookies.map((cookie) => cookie.value) : valueStrings(text)),
    ...(Array.isArray(origins) ? origins : []).flatMap((origin) =>
      values((origin as { localStorage?: unknown } | null)?.localStorage),
    ),
  ]
}

/** What to look for of SCANNED variable `name`: its value, and a session's held values. */
function secretsOf(name: string): unknown[] {
  const value = environment(name)
  if (!value) return []
  if (name.endsWith('_COOKIES_FILE')) {
    // A session file the scan cannot read could hold anything: fail closed.
    try {
      return heldValues(readFileSync(settingPath(environment, value)!, 'utf8'))
    } catch {
      console.error(`Cannot read the file ${name} names, so cannot scan for its values`)
      process.exit(4)
    }
  }
  if (!name.endsWith('_COOKIES')) return [value]
  return [value.trim(), ...heldValues(Buffer.from(value.trim(), 'base64').toString('utf8'))]
}

/** A secret as written, URL-encoded and JSON-escaped. */
const forms = (secret: string) => [
  secret,
  encodeURIComponent(secret),
  JSON.stringify(secret).slice(1, -1),
]

const secrets = [
  ...new Set(
    SCANNED.flatMap(secretsOf)
      .filter((secret): secret is string => typeof secret === 'string' && secret.length >= 8)
      .flatMap(forms),
  ),
]

// Under CI a scan with nothing to look for would pass anything: the step lacks its secrets.
if (tooling().ci && !secrets.length) {
  console.error("No test secret to look for: give this step the job's secrets (see live-e2e.yml)")
  process.exit(3)
}

const leaking = process.argv
  .slice(2)
  .filter(existsSync)
  .filter((file) => {
    const bytes = readFileSync(file)
    return secrets.some((secret) => bytes.includes(secret))
  })
if (leaking.length) {
  console.error(`Secrets in: ${leaking.join(', ')}`)
  process.exit(2)
}
