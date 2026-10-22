// local.ts against the files that repeat its origins.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { APP_ORIGIN, BRIDGE, NOTARY } from './local.ts'

test("Bridge admits the app's origin", () => {
  const config = readFileSync(new URL('./bridge-config.toml', import.meta.url), 'utf8')
  const listed = /^allowed_app_origins\s*=\s*\[([^\]]*)\]/m.exec(config)?.[1]
  assert.ok(listed, 'bridge-config.toml has allowed_app_origins')
  const origins = [...listed.matchAll(/"([^"]*)"/g)].map((match) => match[1])
  assert.ok(origins.includes(APP_ORIGIN), `allowed_app_origins lacks ${APP_ORIGIN}`)
})

test("the README's service table and links name local.ts' origins", () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8')
  for (const line of [
    `| Application | ${APP_ORIGIN} |`,
    `| OAuth Bridge | ${BRIDGE} |`,
    `| Notary HTTP/WebSocket | ${NOTARY} |`,
    `Open **${APP_ORIGIN}**`,
    `**\`${BRIDGE}/auth/callback\`**`,
  ])
    assert.ok(readme.includes(line), `the README says ${line}`)
})
