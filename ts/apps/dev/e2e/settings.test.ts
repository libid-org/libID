// The settings table against the places that repeat it: the live workflow and
// the README. Read as text; no secrets, no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { PlatformId } from '@libid/ceremony'
import { missing, type Need, PLATFORM_SECTIONS, VARIABLES } from './settings.ts'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const workflow = read('../../../../.github/workflows/live-e2e.yml')

/** The jobs that run live tests. */
const JOBS = ['ceremony', 'google-ssm']

const isSetting = (name: string) => VARIABLES.some(([setting]) => setting === name)
/** A name of the kind the settings own. */
const looksLikeSetting = (name: string) => /_TEST_ALICE_/.test(name) || name.startsWith('LIBID_')

/** An `env:` entry's key and value, if `line` is one. */
function envEntry(line: string): [string, string] | undefined {
  const match = /^\s+([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line)
  return match ? [match[1]!, match[2]!] : undefined
}

/** Every name `text` reads as `secrets.NAME` or `vars.NAME`. */
const referenced = (text: string) =>
  new Set([...text.matchAll(/\b(?:secrets|vars)\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!))

/** The lines of job `name`'s test step (`id: test`). */
function testStep(name: string): string[] {
  const lines = workflow.split('\njobs:\n')[1]!.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  assert.notEqual(start, -1, `the workflow has a job ${name}`)
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:$/.test(line))
  const job = lines.slice(start, end === -1 ? undefined : end)
  const id = job.indexOf('        id: test')
  assert.notEqual(id, -1, `job ${name} has a step with id test`)
  const isStep = (line: string) => line.startsWith('      - ')
  let first = id
  while (first > 0 && !isStep(job[first]!)) first--
  const next = job.findIndex((line, index) => index > id && isStep(line))
  return job.slice(first, next === -1 ? undefined : next)
}

test('every secret the workflow reads is a setting, passed under its own name', () => {
  for (const name of [...workflow.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]!))
    assert.ok(isSetting(name), `the workflow reads secret ${name}, which the settings do not list`)
  for (const line of workflow.split('\n')) {
    const entry = envEntry(line)
    if (!entry || !looksLikeSetting(entry[0])) continue
    assert.ok(isSetting(entry[0]), `the workflow sets ${entry[0]}, which the settings do not list`)
    const read = referenced(entry[1])
    if (read.size)
      assert.deepEqual(read, new Set([entry[0]]), `${entry[0]} carries its own setting`)
  }
})

test("each job's test step is given what its platforms require", () => {
  for (const name of JOBS) {
    const entries = testStep(name).flatMap((line) => {
      const entry = envEntry(line)
      return entry ? [entry] : []
    })
    // The step's platforms: a list, or the variable's default after `||`.
    const selection = entries.find(([key]) => key === 'LIBID_LIVE_PLATFORMS')?.[1]
    assert.ok(selection, `job ${name}'s test step sets LIBID_LIVE_PLATFORMS`)
    const listed = /\|\|\s*'([^']*)'/.exec(selection)?.[1] ?? selection
    const platforms = listed.split(',').map((platform) => platform.trim()) as PlatformId[]
    for (const platform of platforms)
      assert.ok(platform in PLATFORM_SECTIONS, `job ${name} selects unknown ${platform}`)
    const given = new Set(entries.map(([key]) => key))
    const lookup = (variable: string) => (given.has(variable) ? 'set' : undefined)
    const absent = platforms.flatMap((platform) =>
      PLATFORM_SECTIONS[platform].flatMap((section) => missing(section, lookup)),
    )
    assert.deepEqual(absent, [], `job ${name}'s test step is not given ${absent.join(', ')}`)
  }
})

test("the README's live tests table lists every setting as the table does", () => {
  const rows = read('../README.md')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
  const needText = (need: Need) =>
    typeof need === 'string' ? need : `instead of \`${need.insteadOf}\``
  for (const [name, section, need] of VARIABLES) {
    const row = rows.find((line) => line.startsWith(`| \`${name}\` |`))
    assert.ok(row, `the README lists ${name}`)
    assert.ok(
      row.startsWith(`| \`${name}\` | ${section} | ${needText(need)} |`),
      `the README lists ${name} as in ${section}, ${needText(need)}: ${row}`,
    )
  }
  for (const row of rows) {
    const name = row.slice(3).split('`')[0]!
    assert.ok(isSetting(name), `the README lists ${name}, which the settings do not`)
  }
})
