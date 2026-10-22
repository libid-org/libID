// Refuse to publish a failed run's stack log when it holds a test secret: the
// GitHub password or TOTP secret, or a value of a saved session. Paths are the
// arguments; a missing file is skipped. Nothing secret is printed.
import { existsSync, readFileSync } from 'node:fs'
import { googleSession, xSession } from './session.ts'
import { githubSecrets } from './settings.ts'

const sessions = [xSession(), googleSession()]
const secrets = [
  ...githubSecrets(),
  ...sessions.flatMap((cookies) => cookies?.map((cookie) => cookie.value) ?? []),
].filter((secret): secret is string => !!secret && secret.length >= 8)

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
