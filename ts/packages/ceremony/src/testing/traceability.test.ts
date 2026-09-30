import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Test titles cite the requirements they cover (docs/test-plan.md); traceability maps each row to
// its tests. This keeps the two honest: tested rows are cited, and citations name real rows.

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

/** Test sources, and the fixtures and tables whose strings become test titles. */
function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(ts|mjs)$/.test(path) && !path.endsWith('.d.ts'))
    .map((path) => read(join(dir, path)))
}

const text = [...sources('src'), ...sources('e2e'), ...sources('build')].join('\n')

/** Bracketed tags, with `[A-B-1/2]` expanded to `A-B-1` and `A-B-2`. */
const tags = [...text.matchAll(/\[((?:LIBID|TEST|REQ|KIT|CSP|POPUP)-[^\]\n]*)\]/g)].map(
  ([, tag]) => tag,
)
const cited = new Set(
  tags.flatMap((tag) => {
    const [first, ...rest] = tag.split('/')
    const prefix = first.slice(0, first.lastIndexOf('-') + 1)
    return [first, ...rest.map((suffix) => prefix + suffix)]
  }),
)

const planned = new Set(
  [...read('docs/test-plan.md').matchAll(/^\| (LIBID-[A-Z]+-\d+[A-Z]?) \|/gm)].map(([, id]) => id),
)

const tested = [
  ...read('docs/traceability.md').matchAll(
    /^\| (LIBID-[A-Z]+-\d+[A-Z]?) \| (Automated|Partial) \|/gm,
  ),
].map(([, id]) => id)

it('cites every automated or partially automated requirement in some test', () => {
  expect(tested.length).toBeGreaterThan(0)
  expect(tested.filter((id) => !cited.has(id))).toEqual([])
})

it('cites only requirements the test plan defines', () => {
  const unknown = [...cited].filter((id) => id.startsWith('LIBID-') && !planned.has(id))
  expect(unknown).toEqual([])
})

it('writes each tag as one ID or one slash-joined series, never a list', () => {
  const malformed = tags.filter(
    (tag) => !/^[A-Z]+(?:-[A-Z]+)?-\d+[A-Z]?(?:\/\d+[A-Z]?)*$/.test(tag),
  )
  expect(malformed).toEqual([])
})
