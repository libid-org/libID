import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_NAVIGATION_FRAGMENT_CHARS } from '../src/ccdp/limits.ts'
import { messages } from '../src/ccdp/uiMessages.ts'
import { captureFragment, consumeFragment } from './fragment.ts'

const PATH = '/ccdp/v1/prover'

/** Run the capture script against a document at `url`, recording what it cleared and kept. */
function capture(url: string, options: { hasRoot?: boolean; hasShell?: boolean } = {}) {
  const { hasRoot = true, hasShell = true } = options
  const { pathname, search, hash } = new URL(url, 'https://ccdp.test')
  const location = { pathname, search, hash }
  const cleared: unknown[][] = []
  const label = { textContent: 'initial' }
  let progressRemoved = false
  const progress = {
    remove: () => {
      progressRemoved = true
    },
  }
  const root = {
    textContent: '',
    querySelector: (selector: string) => {
      if (!hasShell) return null
      if (selector === 'p') return label
      if (selector === 'progress') return progress
      return null
    },
  }
  const window: Record<string, unknown> = {}
  const history = {
    replaceState: (...args: unknown[]) => {
      // Once cleared, nothing later reads the launch URL back.
      Object.assign(location, { search: '', hash: '' })
      cleared.push(args)
    },
  }
  const document = {
    getElementById: (id: string) => (id === 'libid-root' && hasRoot ? root : null),
  }
  new Function('location', 'history', 'document', 'window', captureFragment(PATH))(
    location,
    history,
    document,
    window,
  )
  return {
    cleared,
    rootText: root.textContent,
    labelText: label.textContent,
    progressRemoved,
    window,
  }
}

test('clears the launch URL first and keeps only the fragment for the entry [CSP-014] [TEST-CCDP-03]', () => {
  const { cleared, rootText, labelText, progressRemoved, window } = capture(`${PATH}#ceremonyId=1`)
  assert.deepEqual(cleared, [[null, '', PATH]])
  assert.equal(window.__libidCeremonyFragment, '#ceremonyId=1')
  assert.equal(rootText, '')
  assert.equal(labelText, 'initial')
  assert.equal(progressRemoved, false)
})

test('keeps a fragment of exactly the bound, `#` included [CSP-006] [TEST-CCDP-03]', () => {
  const hash = `#${'a'.repeat(MAX_NAVIGATION_FRAGMENT_CHARS - 1)}`
  assert.equal(capture(`${PATH}${hash}`).window.__libidCeremonyFragment, hash)
})

test('refuses a query, another path or an oversized fragment, still clearing the URL [CSP-006] [CSP-014]', () => {
  const refusal = messages.returnToApplication(messages.unableToContinue)
  for (const url of [
    `${PATH}?code=1#ceremonyId=1`,
    '/ccdp/v1/prefetch#ceremonyId=1',
    `${PATH}#${'a'.repeat(MAX_NAVIGATION_FRAGMENT_CHARS)}`,
  ]) {
    const { cleared, rootText, labelText, progressRemoved, window } = capture(url)
    assert.equal(cleared.length, 1, url)
    assert.equal(rootText, '', url)
    assert.equal(labelText, refusal, url)
    assert.equal(progressRemoved, true, url)
    assert.ok(!Object.hasOwn(window, '__libidCeremonyFragment'), url)
  }
})

test('falls back safely when refusal runs without shell children or root element', () => {
  const refusal = messages.returnToApplication(messages.unableToContinue)
  const noShell = capture(`${PATH}?code=1`, { hasShell: false })
  assert.equal(noShell.cleared.length, 1)
  assert.equal(noShell.rootText, refusal)
  assert.equal(noShell.progressRemoved, false)
  assert.ok(!Object.hasOwn(noShell.window, '__libidCeremonyFragment'))

  const noRoot = capture(`${PATH}?code=1`, { hasRoot: false })
  assert.equal(noRoot.cleared.length, 1)
  assert.ok(!Object.hasOwn(noRoot.window, '__libidCeremonyFragment'))
})

test('the entry consumes the captured fragment once', () => {
  const window: Record<string, unknown> = { __libidCeremonyFragment: '#ceremonyId=1' }
  const received: unknown[] = []
  const run = new Function('window', 'start', consumeFragment('start'))
  const start = (fragment: unknown) => void received.push(fragment)
  run(window, start)
  run(window, start)
  assert.deepEqual(received, ['#ceremonyId=1'])
  assert.ok(!Object.hasOwn(window, '__libidCeremonyFragment'))
})
