// Refuse to publish a failed run's stack log when it holds a test secret: the
// GitHub password or TOTP secret, a saved session as set, or a value of its
// cookies. A session that does not decode is still looked for as set. Paths
// are the arguments; a missing file is skipped. Nothing secret is printed.
import { existsSync, readFileSync } from 'node:fs'
import { exportText } from './session.ts'
import { githubSecrets, googleSession, type SavedSession, xSession } from './settings.ts'

/**
 * The session setting's own value, and its cookies' values: from the JSON
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
  try {
    const parsed: unknown = JSON.parse(text)
    const cookies = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown })?.cookies
    if (Array.isArray(cookies))
      return [...raw, ...cookies.map((cookie) => (cookie as { value?: unknown })?.value)].filter(
        (value): value is string => typeof value === 'string',
      )
  } catch {
    // Not JSON: fall back to the value strings in the text.
  }
  return [...raw, ...[...text.matchAll(/"value"\s*:\s*"([^"\\]*)"/g)].map((match) => match[1]!)]
}

const secrets = [
  ...githubSecrets(),
  ...sessionSecrets(xSession()),
  ...sessionSecrets(googleSession()),
].filter((secret) => secret.length >= 8)

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
