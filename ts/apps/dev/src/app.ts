import {
  type CCDPClient,
  CeremonyError,
  type CeremonyEvent,
  CeremonyStage,
  createCCDPClient,
  type IdentityResult,
  type PlatformId,
} from '@libid/ceremony'
import type { LedgerId } from '@libid/ledger'
import { PopupWindow } from '@libid/popup'
import { sha256 } from '@noble/hashes/sha2.js'

declare global {
  interface Window {
    results: Map<string, IdentityResult | { status: 'failed' | 'closed' }>
  }
}
const oauthBridge = 'http://localhost:4682'
/** A synthetic ledger routed to the local notary; its hash names no real Chain Profile. */
const ledger: LedgerId = {
  chain: 'test:local',
  hash: () => new Uint8Array(32).fill(2),
  notaryAddress: () => 'http://localhost:4687',
}
const platforms = document.querySelector<HTMLElement>('#platforms')!
const status = document.querySelector<HTMLElement>('#status')!
window.results = new Map()
document.querySelector('#bridge')!.textContent = oauthBridge
document.querySelector('#notary')!.textContent = ledger.notaryAddress()
const names: Record<PlatformId, string> = { google: 'Google', x: 'X', github: 'GitHub' }
/** A new `tag` element with `properties` assigned. */
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
) => Object.assign(document.createElement(tag), properties)
let client: CCDPClient | undefined
async function initialize() {
  try {
    client = await createCCDPClient({ oauthBridge })
    platforms.replaceChildren(
      ...client.enabledPlatforms.map((platform) => {
        const launch = document.createElement('a')
        launch.className = 'launch'
        launch.href = '/'
        launch.setAttribute('role', 'button')
        launch.textContent = names[platform]
        launch.addEventListener('click', (event) => start(event, platform))
        launch.addEventListener('keydown', (event) => {
          if (event.key === ' ') {
            event.preventDefault()
            launch.click()
          }
        })
        return launch
      }),
    )
    status.textContent = client.enabledPlatforms.length
      ? 'Ready. Click a platform to start a ceremony.'
      : 'The Bridge and its CCDP enable no compatible platforms.'
  } catch {
    status.textContent =
      'Could not load Bridge configuration or the CCDP version list. Check the Bridge address, its application allowlist and its CCDP, then reload this page.'
  }
}
const operationNames: Record<string, string> = {
  'prefetch-dispatch': 'Prefetch dispatch',
  authorization: 'Authorization',
  prover: 'Proving',
  'prover-fallback': 'Prover fallback',
  'token-fetch': 'Token fetch',
  'token-attestation': 'Token attestation',
  'identity-fetch': 'Identity fetch',
  'identity-attestation': 'Identity attestation',
  'zk-proof-preparation': 'ZK proof preparation',
  'proof-backend-initialization': 'ZK backend initialization',
  'zk-proof-generation': 'ZK proof generation',
}
const attributeTitles: Record<string, string> = {
  'openings-ms':
    'TLSNotary proof work until commitment openings arrive, including worker delivery.',
  'finalization-ms': 'From openings until the final correlated attestation arrives.',
}
function attributeList(attributes: Readonly<Record<string, string | number | boolean>>) {
  const values = document.createElement('dl')
  for (const [key, value] of Object.entries(attributes)) {
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = key.replace(/-(ms|bytes)$/, '').replaceAll('-', ' ')
    term.title = Object.hasOwn(attributeTitles, key) ? attributeTitles[key] : ''
    description.textContent =
      typeof value === 'number' && key.endsWith('-ms')
        ? `${value.toFixed(0)} ms`
        : typeof value === 'number' && key.endsWith('-bytes')
          ? `${value} B`
          : String(value)
    values.append(term, description)
  }
  return values
}
function outcomeText(event: CeremonyEvent): string {
  if (event.status === 'completed') return 'Proof received'
  if (event.status === 'closed') return 'Interrupted'
  if (event.status === 'denied') return 'Denied'
  return `Failed (${'event' in event ? event.event : 'ceremony'})`
}
interface Operation {
  name: string
  started: number
  finished?: number
  cell: HTMLLIElement
  label: HTMLElement
}
const now = () => performance.timeOrigin + performance.now()
const duration = (start: number, end: number) => `${Math.max(0, (end - start) / 1000).toFixed(1)} s`
/** One row owns its timings and presentation; its controls are bound to that run only. */
class RunRow {
  readonly message = element('p', {
    className: 'run-status',
    textContent: 'Opening authorization…',
  })
  readonly close = element('button', { type: 'button', textContent: 'Close', disabled: true })
  readonly #cells: HTMLTableCellElement[]
  readonly #outcome = element('strong', { className: 'run-outcome', textContent: 'Running' })
  readonly #timings = element('ol', { className: 'operation-timings' })
  readonly #operations = new Map<string, Operation>()
  readonly #timer = setInterval(() => this.#render(), 100)
  #started: number | undefined
  #finished = false

  constructor(platform: PlatformId, id: string) {
    const row = document.createElement('tr')
    row.dataset.ceremonyId = id
    this.#cells = [new Date().toLocaleTimeString(), names[platform], 'Running', '—'].map((text) =>
      element('td', { textContent: text }),
    )
    this.message.setAttribute('role', 'status')
    this.#cells[2]!.replaceChildren(this.#outcome, this.message)
    const timingsCell = element('td')
    timingsCell.append(this.#timings)
    const actions = element('td', { className: 'run-actions' })
    actions.append(this.close)
    row.append(...this.#cells, timingsCell, actions)
    document.querySelector('#history')!.prepend(row)
    document.querySelector<HTMLElement>('#history-empty')!.hidden = true
  }

  /** Records one event; a terminal one finishes the row. */
  readonly onEvent = (event: CeremonyEvent) => {
    if (this.#finished) return
    // Only the named core operations get a row; extension events would reorder it mid-read.
    if ((event.status === 'active' || event.status === 'completed') && operationNames[event.event])
      this.#track(event)
    if (event.status !== 'active') this.finish(outcomeText(event), event.timestamp)
    else this.#render()
  }

  finish(text: string, timestamp = now()) {
    if (this.#finished) return
    this.#finished = true
    clearInterval(this.#timer)
    this.#render(timestamp)
    this.#outcome.textContent = text
  }

  #render(timestamp = now()) {
    if (this.#started !== undefined)
      this.#cells[3]!.textContent = duration(this.#started, timestamp)
    for (const op of this.#operations.values()) {
      const running = this.#finished ? ' (interrupted)' : ' (running)'
      op.cell.dataset.status =
        op.finished !== undefined ? 'completed' : this.#finished ? 'interrupted' : 'running'
      op.label.textContent = `${op.name} · ${duration(op.started, op.finished ?? timestamp)}${op.finished === undefined ? running : ''}`
    }
  }

  #track(event: Extract<CeremonyEvent, { status: 'active' | 'completed' }>) {
    if (event.event === 'prefetch-dispatch' && event.phase === 'started')
      this.#started = event.timestamp
    const op = this.#operations.get(event.event)
    if ((event.phase === 'started' || event.event === 'prover-fallback') && !op) {
      const cell = document.createElement('li')
      const label = document.createElement('span')
      cell.append(label)
      this.#operations.set(event.event, {
        name: operationNames[event.event]!,
        started: event.timestamp,
        cell,
        label,
      })
      this.#timings.append(cell)
    } else if (event.phase === 'finished' && op) {
      op.finished = event.timestamp
      const attributes = event.status === 'active' ? event.instrumentation?.attributes : undefined
      if (attributes && Object.keys(attributes).length) {
        const details = document.createElement('details')
        const summary = document.createElement('summary')
        summary.append(op.label)
        details.append(summary, attributeList(attributes))
        op.cell.replaceChildren(details)
      }
    }
    // The single-shot fallback observation begins the interval ending at Prover readiness.
    if (event.event === 'prover' && event.phase === 'started') {
      const fallback = this.#operations.get('prover-fallback')
      if (fallback) fallback.finished = event.timestamp
    }
    const ordered = [...this.#operations.values()].sort(
      (a, b) => (a.finished ?? Infinity) - (b.finished ?? Infinity) || a.started - b.started,
    )
    // Move existing rows only when necessary, preserving expanded details.
    for (const [index, { cell }] of ordered.entries()) {
      const next = this.#timings.children[index]
      if (next !== cell) this.#timings.insertBefore(cell, next ?? null)
    }
  }
}
function start(event: MouseEvent, platform: PlatformId) {
  if (!client) {
    event.preventDefault()
    return
  }
  // Keep creation and the native-anchor fallback inside the same user gesture.
  const popup = PopupWindow.fromAnchor(event, 'width=480,height=720')
  const current = client.connect(popup)
  const id = current.connectionId
  const run = new RunRow(platform, id)
  try {
    run.close.disabled = !popup.opened
    // A native-anchor popup supplies its window handle only when it authenticates.
    void current.ready
      .then(() => {
        run.close.disabled = false
      })
      .catch(() => {})
    void current.closed.then(() => {
      run.close.onclick = null
      run.close.remove()
    })
    run.close.onclick = () => {
      void current.close().catch(() => {
        run.message.textContent = 'Could not close the popup. Close its window manually.'
      })
    }
    const ceremony = client.new(
      current,
      platform,
      ledger,
      sha256(new TextEncoder().encode('libid/ceremony/dev')),
      new TextEncoder().encode('Ceremony development walkthrough'),
    )
    document.querySelector('#ccdp')!.textContent = new URL(ceremony.launchUrl).origin
    const off = ceremony.onEvent(run.onEvent)
    const offStage = ceremony.onStage((event) => {
      if (event.status === 'active')
        run.message.textContent = CeremonyStage.message(event.stage, names[platform])
    })
    void ceremony
      .proveUserIdentity()
      .then(async (outcome) => {
        window.results.set(id, outcome)
        run.message.textContent =
          outcome.status === 'denied'
            ? 'Authorization was denied.'
            : 'Proof received. Independent verification has not been run. No transaction was submitted.'
        try {
          await current.close()
        } catch {
          run.message.textContent =
            'Could not close the popup automatically. Close its window manually.'
        }
      })
      .catch((error: unknown) => {
        window.results.set(id, { status: error instanceof CeremonyError ? error.status : 'failed' })
        run.message.textContent = error instanceof Error ? error.message : 'Ceremony failed.'
      })
      .finally(() => {
        off()
        offStage()
      })
  } catch {
    event.preventDefault()
    run.message.textContent = 'Could not start the ceremony. Close any remaining popup and retry.'
    window.results.set(id, { status: 'failed' })
    run.finish('Failed to start')
  }
}
void initialize()
