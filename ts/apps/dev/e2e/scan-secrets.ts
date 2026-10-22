// Refuse to publish a failed run's stack log when it holds a test secret: the
// GitHub password or TOTP secret, a saved session as set, or a value it holds
// (its cookies' and, for a storage state, its origins' localStorage values),
// each also URL-encoded and JSON-escaped. A session that does not decode is
// still looked for as set. Paths are the arguments; a missing file is
// skipped. Under CI, finding no secret to look for fails. Nothing secret is
// printed.
import { existsSync, readFileSync } from 'node:fs'
import { exportText } from './session.ts'
import { githubSecrets, googleSession, type SavedSession, tooling, xSession } from './settings.ts'

/** The `value` strings of `items`, where it is a list. */
const values = (items: unknown) =>
  Array.isArray(items) ? items.map((item) => (item as { value?: unknown } | null)?.value) : []

/**
 * The session setting's own value, and the values it holds: from the JSON
 * where it parses, else every `"value": "…"` string its text holds.
 */
function sessionSecrets(saved: SavedSession | undefined): string[] {
  if (!saved) return []
  const raw = 'encoded' in saved ? [saved.encoded.trim()] : []
  let text: string
  try {
    text = exportText(saved)
  } catch {
    return raw
  }
  let held: unknown[]
  try {
    const parsed = JSON.parse(text) as unknown
    const state = parsed as { cookies?: unknown; origins?: unknown } | null
    held = Array.isArray(parsed)
      ? values(parsed)
      : [
          ...values(state?.cookies),
          ...(Array.isArray(state?.origins) ? state.origins : []).flatMap((origin) =>
            values((origin as { localStorage?: unknown } | null)?.localStorage),
          ),
        ]
  } catch {
    held = [...text.matchAll(/"value"\s*:\s*"([^"\\]*)"/g)].map((match) => match[1])
  }
  return [...raw, ...held.filter((value): value is string => typeof value === 'string')]
}

/** A secret as written, URL-encoded and JSON-escaped. */
const forms = (secret: string) => [
  secret,
  encodeURIComponent(secret),
  JSON.stringify(secret).slice(1, -1),
]

const secrets = [
  ...new Set(
    [...githubSecrets(), ...sessionSecrets(xSession()), ...sessionSecrets(googleSession())]
      .filter((secret) => secret.length >= 8)
      .flatMap(forms),
  ),
]

// Under CI a scan with nothing to look for would pass anything: the step lacks its secrets.
if (tooling().ci && !secrets.length) {
  console.error("No test secret to look for: give this step the job's secrets (see live-e2e.yml)")
  process.exit(1)
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
  process.exit(1)
}
