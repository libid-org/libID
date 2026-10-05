import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_NAVIGATION_FRAGMENT_CHARS } from '../src/ccdp/limits.ts'
import { messages } from '../src/ccdp/uiMessages.ts'
import { captureFragment, consumeFragment } from './fragment.ts'

const PATH = '/ccdp/v1/prover'

/** Run the capture script against a document at `url`, recording what it cleared and kept. */
function capture(url: string) {
  const { pathname, search, hash } = new URL(url, 'https://ccdp.test')
  const location = { pathname, search, hash }
  const cleared: unknown[][] = []
  const root = { textContent: '' }
  const window: Record<string, unknown> = {}
  const history = {
    replaceState: (...args: unknown[]) => {
      // Once cleared, nothing later reads the launch URL back.
      Object.assign(location, { search: '', hash: '' })
      cleared.push(args)
    },
  }
  const document = { getElementById: (id: string) => (id === 'libid-root' ? root : null) }
  new Function('location', 'history', 'document', 'window', captureFragment(PATH))(
    location,
    history,
    document,
    window,
  )
  return { cleared, text: root.textContent, window }
}

test('clears the launch URL first and keeps only the fragment for the entry [CSP-014] [TEST-CCDP-03]', () => {
  const { cleared, text, window } = capture(`${PATH}#ceremonyId=1`)
  assert.deepEqual(cleared, [[null, '', PATH]])
  assert.equal(window.__libidCeremonyFragment, '#ceremonyId=1')
  assert.equal(text, '')
})

test('refuses a query, another path or an oversized fragment, still clearing the URL [CSP-006] [CSP-014]', () => {
  const refusal = messages.returnToApplication(messages.unableToContinue)
  for (const url of [
    `${PATH}?code=1#ceremonyId=1`,
    '/ccdp/v1/prefetch#ceremonyId=1',
    `${PATH}#${'a'.repeat(MAX_NAVIGATION_FRAGMENT_CHARS)}`,
  ]) {
    const { cleared, text, window } = capture(url)
    assert.equal(cleared.length, 1, url)
    assert.equal(text, refusal, url)
    assert.ok(!Object.hasOwn(window, '__libidCeremonyFragment'), url)
  }
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
