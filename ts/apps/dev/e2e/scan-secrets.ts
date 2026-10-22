// Refuse to publish a failed run's output when any file holds a test secret:
// the GitHub password or TOTP secret, or a value of a saved session. Paths
// are the arguments; directories are searched. Nothing secret is printed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { googleSession, xSession } from './session.ts'

const sessions = [xSession(), googleSession()]
const secrets = [
  process.env.GH_TEST_ALICE_PASSWORD,
  process.env.GH_TEST_ALICE_TOTP_SECRET,
  ...sessions.flatMap((cookies) => cookies?.map((cookie) => cookie.value) ?? []),
].filter((secret): secret is string => !!secret && secret.length >= 8)

const files = (path: string): string[] =>
  !existsSync(path)
    ? []
    : statSync(path).isDirectory()
      ? readdirSync(path).flatMap((name) => files(join(path, name)))
      : [path]

const leaking = process.argv
  .slice(2)
  .flatMap(files)
  .filter((file) => {
    const bytes = readFileSync(file)
    return secrets.some((secret) => bytes.includes(secret))
  })
if (leaking.length) {
  console.error(`Secrets in: ${leaking.join(', ')}`)
  process.exit(1)
}
