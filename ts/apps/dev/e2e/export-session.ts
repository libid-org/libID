// Saves the session of a Chrome profile a person signed in to by hand, as the
// JSON X_TEST_ALICE_COOKIES_FILE and GOOGLE_TEST_ALICE_COOKIES_FILE read; each
// test keeps only its platform's cookies. X and Google examine or refuse a
// sign-in in an automated browser, so the sign-in is in plain Chrome
// (README, "Saved sessions"). Close that Chrome, then:
//
//   node e2e/export-session.ts <profile-dir> <out.json>
import { chromium } from '@playwright/test'

const [profile, out] = process.argv.slice(2)
if (!profile || !out) throw new Error('Usage: node e2e/export-session.ts <profile-dir> <out.json>')

// The same Chrome and password store that wrote the profile, so its cookies decrypt.
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  args: ['--password-store=basic'],
})
await context.storageState({ path: out })
await context.close()
console.log(
  `Saved ${out}. It is a credential: keep it out of the repository and delete it after use.`,
)
