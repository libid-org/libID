import {
  type Ceremony,
  type CCDPClient,
  CeremonyError,
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
    result?: IdentityResult | { status: 'failed' | 'cancelled' }
  }
}
const settings = { bridge: 'http://localhost:4682', ccdp: 'http://localhost:4683' }
const ledger: LedgerId = { ...testnet, notaryAddress: () => 'http://localhost:4687' }
const platforms = document.querySelector<HTMLElement>('#platforms')!
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!
const close = document.querySelector<HTMLButtonElement>('#close')!
const status = document.querySelector<HTMLElement>('#status')!
const result = document.querySelector<HTMLElement>('#result')!
document.querySelector('#bridge')!.textContent = settings.bridge
document.querySelector('#ccdp')!.textContent = settings.ccdp
document.querySelector('#notary')!.textContent = ledger.notaryAddress()
const names: Record<PlatformId, string> = { google: 'Google', x: 'X', github: 'GitHub' }
let client: CCDPClient | undefined
let active: Ceremony | undefined
let connection: PopupConnection<Message> | undefined
function controls() {
  const ready = !!client?.enabledPlatforms.length && !active && !connection
  for (const launch of platforms.querySelectorAll('a')) {
    launch.setAttribute('aria-disabled', String(!ready))
    launch.tabIndex = ready ? 0 : -1
  }
  cancel.disabled = !active
  close.disabled = !connection
}
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
      'Could not load Bridge configuration. Check its address, certificate and application allowlist, then reload this page.'
  } finally {
    controls()
  }
}
function beginRun(platform: PlatformId) {
  const now = () => performance.timeOrigin + performance.now()
  const started = now()
  const row = document.createElement('tr')
  const cells = [new Date().toLocaleTimeString(), names[platform], 'Running', '—', '—'].map(
    (text) => {
      const cell = document.createElement('td')
      cell.textContent = text
      row.append(cell)
      return cell
    },
  )
  document.querySelector('#history')!.prepend(row)
  document.querySelector<HTMLElement>('#history-empty')!.hidden = true
  const timings = document.createElement('ol')
  timings.className = 'stage-timings'
  const timingsCell = document.createElement('td')
  timingsCell.append(timings)
  row.append(timingsCell)
  let current: { stage: CeremonyStage; started: number; cell: HTMLLIElement } | undefined
  let returnedAt: number | undefined
  let finished = false
  const duration = (start: number, end: number) =>
    `${Math.max(0, (end - start) / 1000).toFixed(1)} s`
  const render = (timestamp = now(), completed = false) => {
    cells[3]!.textContent = duration(started, timestamp)
    if (returnedAt !== undefined) cells[4]!.textContent = duration(returnedAt, timestamp)
    if (current)
      current.cell.textContent = `${completed ? CeremonyStage.completed(current.stage) : CeremonyStage.inProgress(current.stage)} · ${duration(current.started, timestamp)}`
  }
  const timer = setInterval(render, 100)
  const finish = (outcome: string, timestamp = now(), success = false) => {
    if (finished) return
    finished = true
    clearInterval(timer)
    render(timestamp, success)
    if (current && !success) current.cell.textContent += ` (${outcome.toLowerCase()})`
    cells[2]!.textContent = outcome
  }
  return {
    finish,
    onEvent(event: CeremonyEvent) {
      if (finished || event.type === 'step') return
      if (event.type === 'finished') {
        finish(
          event.outcome === 'success'
            ? 'Proof received'
            : event.outcome === 'denied'
              ? 'Denied'
              : event.outcome === 'cancelled'
                ? 'Cancelled'
                : event.outcome === 'failed' && event.code
                  ? `Failed (${event.code})`
                  : 'Failed',
          event.timestamp,
          event.outcome === 'success',
        )
        return
      }
      if (event.stage === 'oauth-return') returnedAt = event.timestamp
      const stage = CeremonyStage.group(event.stage)
      if (current?.stage === stage) {
        render(event.timestamp)
        return
      }
      render(event.timestamp, true)
      const cell = document.createElement('li')
      const first = !current
      current = { stage, started: first ? started : event.timestamp, cell }
      timings.append(cell)
      render(event.timestamp)
    },
  }
}
function start(event: MouseEvent, launch: HTMLAnchorElement, platform: PlatformId) {
  if (!client || launch.getAttribute('aria-disabled') === 'true') {
    event.preventDefault()
    return
  }
  const id = crypto.randomUUID()
  const run = beginRun(platform)
  launch.target = `ceremony-dev-${id}`
  // Keep creation and the native-anchor fallback inside the same user gesture.
  const popup = PopupWindow.open(launch.target, 'width=480,height=720')
  window.result = undefined
  result.textContent = 'Waiting for a result.'
  let current: PopupConnection<Message>
  let ceremony: Ceremony
  try {
    current = PopupConnection.connect(popup, {
      connectionId: id,
      allowedPopupOrigins: [...new Set([settings.bridge, settings.ccdp])],
    })
    connection = current
    ceremony = client.new(
      current,
      id,
      ledger,
      platform,
      sha256(new TextEncoder().encode('libid/ceremony/dev')),
      new TextEncoder().encode('Ceremony development walkthrough'),
    )
  } catch {
    event.preventDefault()
    status.textContent = 'Could not start the ceremony. Close any remaining popup and retry.'
    window.result = { status: 'failed' }
    result.textContent = 'No ceremony started.'
    run.finish('Failed to start')
    void connection?.close().catch(() => {})
    connection = undefined
    controls()
    return
  }
  active = ceremony
  launch.href = ceremony.launchUrl
  if (popup.opened) event.preventDefault()
  status.textContent = 'Opening authorization…'
  controls()
  const off = ceremony.onEvent((event) => {
    run.onEvent(event)
    if (event.type === 'stage')
      status.textContent = `${CeremonyStage.inProgress(CeremonyStage.group(event.stage))}…`
  })
  let failed = false
  void current.closed.then(() => {
    if (connection === current) {
      connection = undefined
      if (failed) status.textContent = 'Popup closed. Start a fresh attempt.'
    }
    controls()
  })
  void ceremony
    .proveUserIdentity()
    .then((outcome) => {
      window.result = outcome
      result.textContent =
        outcome.status === 'denied'
          ? 'Authorization was denied.'
          : 'Proof received. Independent verification has not been run. No transaction was submitted.'
      status.textContent = 'Ceremony finished.'
    })
    .catch((error: unknown) => {
      const cancelled = error instanceof Error && error.name === 'AbortError'
      failed = !cancelled
      window.result = { status: cancelled ? 'cancelled' : 'failed' }
      result.textContent = cancelled
        ? 'Ceremony cancelled.'
        : error instanceof CeremonyError
          ? `${error.message} (${error.code})`
          : 'Ceremony failed.'
      status.textContent =
        failed && connection === current
          ? 'Ceremony failed. The popup is open for inspection; close it before starting another attempt.'
          : 'Ceremony stopped.'
    })
    .finally(async () => {
      off()
      if (!failed) {
        try {
          await current.close()
        } catch {
          status.textContent = 'Could not close the popup automatically. Close its window manually.'
        }
      }
      active = undefined
      controls()
    })
}
cancel.addEventListener('click', () => {
  cancel.disabled = true
  void active?.cancel().catch(() => {
    status.textContent = 'Cancellation failed. Close the popup to end this attempt.'
  })
})
close.addEventListener('click', () => {
  close.disabled = true
  void connection?.close().catch(() => {
    status.textContent = 'Could not close the popup automatically. Close its window manually.'
    controls()
  })
})
void initialize()
