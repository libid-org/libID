// The settings table against the places that repeat it: the live workflow and
// the README. Read as text; no secrets, no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { PlatformId } from '@libid/ceremony'
import {
  ACTION,
  DRIVER,
  NAVIGATION,
  OUTCOME,
  READY,
  STACK_START,
  STACK_STOP,
  TEST,
} from './budgets.ts'
import { missing, type Need, PLATFORM_SECTIONS, SCANNED, VARIABLES } from './settings.ts'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const workflow = read('../../../../.github/workflows/live-e2e.yml')

/**
 * Minutes a job needs beside its test step: checkout, install, the browser
 * install, any proxy, and the failure-output step.
 */
const JOB_ALLOWANCE = 10

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

/** The lines of job `name`. */
function jobLines(name: string): string[] {
  const lines = workflow.split('\njobs:\n')[1]!.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  assert.notEqual(start, -1, `the workflow has a job ${name}`)
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:$/.test(line))
  return lines.slice(start, end === -1 ? undefined : end)
}

/** The lines of job `name`'s step holding the line `marker`. */
function step(name: string, marker: string): string[] {
  const job = jobLines(name)
  const at = job.findIndex((line) => line.trim() === marker)
  assert.notEqual(at, -1, `job ${name} has a step with ${marker}`)
  const isStep = (line: string) => line.startsWith('      - ')
  let first = at
  while (first > 0 && !isStep(job[first]!)) first--
  const next = job.findIndex((line, index) => index > at && isStep(line))
  return job.slice(first, next === -1 ? undefined : next)
}

/** The lines of job `name`'s test step (`id: test`). */
const testStep = (name: string) => step(name, 'id: test')

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

/**
 * The platforms job `name`'s test step can prove: every one when the
 * repository variable may choose, else the ones it lists.
 */
function selectable(entries: [string, string][], name: string): PlatformId[] {
  const selection = entries.find(([key]) => key === 'LIBID_LIVE_PLATFORMS')?.[1]
  assert.ok(selection, `job ${name}'s test step sets LIBID_LIVE_PLATFORMS`)
  if (referenced(selection).size) return Object.keys(PLATFORM_SECTIONS) as PlatformId[]
  const platforms = selection.split(',').map((platform) => platform.trim()) as PlatformId[]
  for (const platform of platforms)
    assert.ok(platform in PLATFORM_SECTIONS, `job ${name} selects unknown ${platform}`)
  return platforms
}

const entriesOf = (lines: string[]) =>
  lines.flatMap((line) => {
    const entry = envEntry(line)
    return entry ? [entry] : []
  })

test("each job's test step is given what every platform it can select requires", () => {
  for (const name of JOBS) {
    const entries = entriesOf(testStep(name))
    const given = new Set(entries.map(([key]) => key))
    const lookup = (variable: string) => (given.has(variable) ? 'set' : undefined)
    const absent = selectable(entries, name).flatMap((platform) =>
      PLATFORM_SECTIONS[platform].flatMap((section) => missing(section, lookup)),
    )
    assert.deepEqual(absent, [], `job ${name}'s test step is not given ${absent.join(', ')}`)
  }
})

test("each job's failure-output step is given every scanned secret its test step is", () => {
  for (const name of JOBS) {
    const tested = new Set(entriesOf(testStep(name)).map(([key]) => key))
    const output = new Set(
      entriesOf(step(name, 'uses: ./.github/actions/live-e2e-output')).map(([key]) => key),
    )
    const absent = SCANNED.filter((secret) => tested.has(secret) && !output.has(secret))
    assert.deepEqual(absent, [], `job ${name}'s failure-output step lacks ${absent.join(', ')}`)
  }
})

test('each test step outlasts its worst case, and each job its step and setup', () => {
  const minutes = (ms: number) => ms / 60_000
  const sum = NAVIGATION + READY + ACTION + DRIVER + OUTCOME
  assert.ok(
    TEST >= sum,
    `the test timeout ${minutes(TEST)} min is under its budgets' ${minutes(sum)}`,
  )
  for (const name of JOBS) {
    const step = testStep(name)
    const timeout = Number(/^\s+timeout-minutes:\s*(\d+)/m.exec(step.join('\n'))?.[1])
    const worst = minutes(
      STACK_START + selectable(entriesOf(step), name).length * TEST + STACK_STOP,
    )
    assert.ok(timeout >= worst, `job ${name}'s test step allows ${timeout} min of ${worst}`)
    const job = Number(/^ {4}timeout-minutes:\s*(\d+)/m.exec(jobLines(name).join('\n'))?.[1])
    assert.ok(
      job >= timeout + JOB_ALLOWANCE,
      `job ${name} allows ${job} min: its test step's ${timeout} and ${JOB_ALLOWANCE} for the rest`,
    )
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
