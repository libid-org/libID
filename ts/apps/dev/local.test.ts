// local.ts against bridge-config.toml, which repeats the app's origin.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { APP_ORIGIN } from './local.ts'

test("Bridge admits the app's origin", () => {
  const config = readFileSync(new URL('./bridge-config.toml', import.meta.url), 'utf8')
  const listed = /^allowed_app_origins\s*=\s*\[([^\]]*)\]/m.exec(config)?.[1]
  assert.ok(listed, 'bridge-config.toml has allowed_app_origins')
  const origins = [...listed.matchAll(/"([^"]*)"/g)].map((match) => match[1])
  assert.ok(origins.includes(APP_ORIGIN), `allowed_app_origins lacks ${APP_ORIGIN}`)
})
