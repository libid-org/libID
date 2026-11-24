import { afterEach, expect, it, vi } from 'vitest'
import { EventFeed } from '../../events.js'
import { messages } from '../uiMessages.js'
import { adoptShell, eventView, view } from './ui.js'

interface FakeElement {
  tag: string
  className: string
  textContent: string
  max: number
  value: number
  removed: boolean
  attributes: Record<string, string>
  children: FakeElement[]
  setAttribute(name: string, value: string): void
  append(...nodes: FakeElement[]): void
  replaceChildren(...nodes: FakeElement[]): void
  remove(): void
  querySelector(selector: string): FakeElement | null
}

function element(
  tag: string,
  attributes: Record<string, string> = {},
  textContent = '',
): FakeElement {
  const el: FakeElement = {
    tag,
    className: '',
    textContent,
    max: 1,
    value: 0,
    removed: false,
    attributes: { ...attributes },
    children: [],
    setAttribute(name, value) {
      el.attributes[name] = value
    },
    append(...nodes) {
      el.children.push(...nodes)
    },
    replaceChildren(...nodes) {
      el.children = [...nodes]
    },
    remove() {
      el.removed = true
    },
    querySelector(selector) {
      if (selector === 'p[role="status"]')
        return el.children.find((c) => c.tag === 'p' && c.attributes.role === 'status') ?? null
      if (selector === 'progress') return el.children.find((c) => c.tag === 'progress') ?? null
      return null
    },
  }
  return el
}

function stubDocument(root: FakeElement | null, hidden = false) {
  const createElement = vi.fn((tag: string) => element(tag))
  vi.stubGlobal('document', {
    hidden,
    getElementById: (id: string) => (id === 'libid-root' ? root : null),
    createElement,
  })
  return { createElement }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('adopts a pre-rendered shell in place without tearing down DOM or restarting progress', () => {
  const root = element('main')
  const logo = element('div', { 'aria-label': messages.brand }, messages.brand)
  const label = element('p', { role: 'status' }, messages.proofPreparation)
  const bar = element('progress', { 'aria-label': messages.progress })
  root.append(logo, label, bar)
  const replace = vi.spyOn(root, 'replaceChildren')
  const { createElement } = stubDocument(root)

  const shell = adoptShell(messages.preparation)
  expect(replace).not.toHaveBeenCalled()
  expect(createElement).not.toHaveBeenCalled()
  expect(shell.label).toBe(label)
  expect(shell.bar).toBe(bar)
  // Preserves the pre-rendered label text until updated.
  expect(label.textContent).toBe(messages.proofPreparation)

  shell.message('Working')
  expect(label.textContent).toBe('Working')
  shell.fail('Failed')
  expect(bar.removed).toBe(true)
  expect(label.textContent).toBe('Failed')
})

it('builds the shell when #libid-root is empty and throws when it is missing', () => {
  const root = element('main')
  stubDocument(root)
  const shell = adoptShell(messages.preparation)
  expect(root.children.map((c) => c.tag)).toEqual(['div', 'p', 'progress'])
  expect(shell.label.textContent).toBe(messages.preparation)

  stubDocument(null)
  expect(() => adoptShell(messages.preparation)).toThrow(messages.missingRoot)
  expect(() => view(messages.preparation)).toThrow(messages.missingRoot)
})

it('drives stage updates, progress, slow-proving hint, and terminal cleanup in eventView', async () => {
  vi.useFakeTimers()
  const root = element('main')
  const label = element('p', { role: 'status' }, messages.proofPreparation)
  const bar = element('progress', { 'aria-label': messages.progress })
  root.append(element('div'), label, bar)
  stubDocument(root, true)

  const feed = new EventFeed()
  const ui = eventView(feed)
  expect(ui).toBeDefined()
  ui.trackProof({ 'zk-proof-generation': 1 })
  feed.emit({ event: 'prover', phase: 'started', timestamp: 1, status: 'active' })
  await vi.advanceTimersByTimeAsync(15000)
  expect(root.children.some((c) => c.className === 'libid-hint')).toBe(true)
  await ui.finishProof()
  expect(bar.value).toBe(1)
  ui.delivered()
  expect(label.textContent).toContain(messages.proofDelivered)
  feed.emit({ status: 'denied', timestamp: 2 })
  expect(bar.removed).toBe(true)
  ui.stop()
  expect(vi.getTimerCount()).toBe(0)
})
