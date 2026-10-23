// Saves a Chrome profile's session as the JSON GOOGLE_TEST_ALICE_COOKIES holds
// (base64-encoded). Google refuses sign-in in an automated browser, so a person
// signs in first, in plain Chrome, through the proxy CI uses:
//
//   google-chrome --user-data-dir=/tmp/google-session --password-store=basic \
//     --proxy-server=http://127.0.0.1:3128 https://myaccount.google.com/
//
// Close that Chrome, then: node e2e/export-session.ts /tmp/google-session out.json
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
