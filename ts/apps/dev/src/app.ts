import { CeremonyError } from '@libid/ceremony'
import {
  type CCDPClient,
  type CeremonyEvent,
  CeremonyStage,
  createCCDPClient,
  type IdentityResult,
  type PlatformId,
} from '@libid/ceremony/ccdp/client'
import type { LedgerId } from '@libid/ledger'
import { testnet } from '@libid/ledger/testing'
import { type Message, PopupConnection, PopupWindow } from '@libid/popup'
import { sha256 } from '@noble/hashes/sha2.js'

declare global {
  interface Window {
    results: Map<string, IdentityResult | { status: 'failed' | 'closed' }>
  }
}
const settings = { bridge: 'http://localhost:4682', ccdp: 'http://localhost:4683' }
const ledger: LedgerId = { ...testnet, notaryAddress: () => 'http://localhost:4687' }
const platforms = document.querySelector<HTMLElement>('#platforms')!
const status = document.querySelector<HTMLElement>('#status')!
window.results = new Map()
document.querySelector('#bridge')!.textContent = settings.bridge
document.querySelector('#ccdp')!.textContent = settings.ccdp
document.querySelector('#notary')!.textContent = ledger.notaryAddress()
const names: Record<PlatformId, string> = { google: 'Google', x: 'X', github: 'GitHub' }
let client: CCDPClient | undefined
async function initialize() {
  try {
    client = await createCCDPClient({ oauthBridge: settings.bridge })
    platforms.replaceChildren(
      ...client.enabledPlatforms.map((platform) => {
        const launch = document.createElement('a')
        launch.className = 'launch'
        launch.href = '/'
        launch.setAttribute('role', 'button')
        launch.textContent = names[platform]
        launch.addEventListener('click', (event) => start(event, launch, platform))
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
      : 'The Bridge has no compatible platforms enabled.'
  } catch {
    status.textContent =
      'Could not load Bridge configuration. Check its address and application allowlist, then reload this page.'
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
/** One row owns its timings and presentation; its controls are bound to that run only. */
function beginRun(platform: PlatformId, id: string) {
  const now = () => performance.timeOrigin + performance.now()
  const row = document.createElement('tr')
  row.dataset.ceremonyId = id
  const cells = [new Date().toLocaleTimeString(), names[platform], 'Running', '—'].map((text) => {
    const cell = document.createElement('td')
    cell.textContent = text
    row.append(cell)
    return cell
  })
  const outcome = document.createElement('strong')
  outcome.className = 'run-outcome'
  outcome.textContent = 'Running'
  const message = document.createElement('p')
  message.className = 'run-status'
  message.setAttribute('role', 'status')
  message.textContent = 'Opening authorization…'
  cells[2]!.replaceChildren(outcome, message)
  document.querySelector('#history')!.prepend(row)
  document.querySelector<HTMLElement>('#history-empty')!.hidden = true
  const timings = document.createElement('ol')
  timings.className = 'operation-timings'
  const timingsCell = document.createElement('td')
  timingsCell.append(timings)
  row.append(timingsCell)
  const actions = document.createElement('td')
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.disabled = true
  actions.append(close)
  actions.className = 'run-actions'
  row.append(actions)
  const operations = new Map<
    string,
    { name: string; started: number; finished?: number; cell: HTMLLIElement; label: HTMLElement }
  >()
  let started: number | undefined,
    finished = false
  const duration = (start: number, end: number) =>
    `${Math.max(0, (end - start) / 1000).toFixed(1)} s`
  const render = (timestamp = now()) => {
    if (started !== undefined) cells[3]!.textContent = duration(started, timestamp)
    for (const op of operations.values()) {
      op.cell.dataset.status =
        op.finished !== undefined ? 'completed' : finished ? 'interrupted' : 'running'
      op.label.textContent = `${op.name} · ${duration(op.started, op.finished ?? timestamp)}${op.finished === undefined ? (finished ? ' (interrupted)' : ' (running)') : ''}`
    }
  }
  const timer = setInterval(render, 100)
  const finish = (text: string, timestamp = now()) => {
    if (finished) return
    finished = true
    clearInterval(timer)
    render(timestamp)
    outcome.textContent = text
  }
  return {
    finish,
    message,
    close,
    onEvent(event: CeremonyEvent) {
      if (finished) return
      if (
        (event.status === 'active' || event.status === 'completed') &&
        operationNames[event.event]
      ) {
        if (event.event === 'prefetch-dispatch' && event.phase === 'started')
          started = event.timestamp
        const op = operations.get(event.event)
        if ((event.phase === 'started' || event.event === 'prover-fallback') && !op) {
          const cell = document.createElement('li')
          const label = document.createElement('span')
          cell.append(label)
          operations.set(event.event, {
            name: operationNames[event.event],
            started: event.timestamp,
            cell,
            label,
          })
          timings.append(cell)
        } else if (event.phase === 'finished' && op) {
          op.finished = event.timestamp
          const attributes =
            event.status === 'active' ? event.instrumentation?.attributes : undefined
          if (attributes && Object.keys(attributes).length) {
            const details = document.createElement('details')
            const summary = document.createElement('summary')
            const values = document.createElement('dl')
            for (const [key, value] of Object.entries(attributes)) {
              const term = document.createElement('dt')
              const description = document.createElement('dd')
              term.textContent = key.replace(/-(ms|bytes)$/, '').replaceAll('-', ' ')
              term.title =
                key === 'openings-ms'
                  ? 'TLSNotary proof work until commitment openings arrive, including worker delivery.'
                  : key === 'finalization-ms'
                    ? 'From openings until the final correlated attestation arrives.'
                    : ''
              description.textContent =
                typeof value === 'number' && key.endsWith('-ms')
                  ? `${value.toFixed(0)} ms`
                  : typeof value === 'number' && key.endsWith('-bytes')
                    ? `${value} B`
                    : String(value)
              values.append(term, description)
            }
            summary.append(op.label)
            details.append(summary, values)
            op.cell.replaceChildren(details)
          }
        }
        // The single-shot fallback observation begins the interval ending at Prover readiness.
        if (event.event === 'prover' && event.phase === 'started') {
          const fallback = operations.get('prover-fallback')
          if (fallback) fallback.finished = event.timestamp
        }
        const ordered = [...operations.values()].sort(
          (a, b) => (a.finished ?? Infinity) - (b.finished ?? Infinity) || a.started - b.started,
        )
        // Move existing rows only when necessary, preserving expanded details.
        for (const [index, { cell }] of ordered.entries()) {
          const next = timings.children[index]
          if (next !== cell) timings.insertBefore(cell, next ?? null)
        }
      }
      if (event.status !== 'active')
        finish(
          event.status === 'completed'
            ? 'Proof received'
            : event.status === 'closed'
              ? 'Interrupted'
              : event.status === 'denied'
                ? 'Denied'
                : `Failed (${'event' in event ? event.event : 'ceremony'})`,
          event.timestamp,
        )
      else render()
    },
  }
}
function start(event: MouseEvent, launch: HTMLAnchorElement, platform: PlatformId) {
  if (!client) {
    event.preventDefault()
    return
  }
  const id = crypto.randomUUID()
  const run = beginRun(platform, id)
  launch.target = `ceremony-dev-${id}`
  // Keep creation and the native-anchor fallback inside the same user gesture.
  try {
    const popup = PopupWindow.open(launch.target, 'width=480,height=720')
    const current = PopupConnection.connect<Message>(popup, {
      connectionId: id,
      allowedPopupOrigins: [...new Set([settings.bridge, settings.ccdp])],
    })
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
      id,
      platform,
      ledger,
      sha256(new TextEncoder().encode('libid/ceremony/dev')),
      new TextEncoder().encode('Ceremony development walkthrough'),
    )
    launch.href = ceremony.launchUrl
    if (popup.opened) event.preventDefault()
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
