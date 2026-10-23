// What a live run checks before its stack starts, in the runner process.
import { totp } from './github.ts'
import { googleSession, xSession } from './session.ts'
import { checkSettings, githubAccount, tooling } from './settings.ts'

/**
 * The settings, then under LIBID_REQUIRE_LIVE each selected platform's saved
 * session and TOTP key: a bad one fails in seconds, not after the stack.
 */
export function preflight() {
  checkSettings()
  const { requireLive, platforms } = tooling()
  if (!requireLive) return
  if (platforms.includes('github')) totp(githubAccount()!.totpSecret)
  if (platforms.includes('x')) xSession()
  if (platforms.includes('google')) googleSession()
}
