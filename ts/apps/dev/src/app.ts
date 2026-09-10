import { CeremonyError } from '@libid/ceremony/client'
import { LedgerId } from '@libid/ledger'
import {
  createCeremonyClient,
  type Ceremony,
  type CeremonyClient,
  type IdentityResult,
  type PlatformId,
} from '@libid/ceremony/client'
import { PopupConnection, PopupWindow, type Message } from '@libid/popup'
import { sha256 } from '@noble/hashes/sha2.js'

declare const __CEREMONY_DEV__: { bridge: string; ccdp: string }
declare global {
  interface Window {
    result?: IdentityResult | { status: 'failed' | 'cancelled' }
  }
}
const settings = __CEREMONY_DEV__
const platforms = document.querySelector<HTMLElement>('#platforms')!
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!
const close = document.querySelector<HTMLButtonElement>('#close')!
const status = document.querySelector<HTMLElement>('#status')!
const result = document.querySelector<HTMLElement>('#result')!
document.querySelector('#bridge')!.textContent = settings.bridge
document.querySelector('#ccdp')!.textContent = settings.ccdp
const names: Record<PlatformId, string> = { google: 'Google', x: 'X', github: 'GitHub' }
let client: CeremonyClient | undefined
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
    client = await createCeremonyClient({ oauthBridge: settings.bridge })
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
  const started = performance.now()
  const row = document.createElement('tr')
  const cells = [new Date().toLocaleTimeString(), names[platform], 'Running', '—'].map((text) => {
    const cell = document.createElement('td')
    cell.textContent = text
    row.append(cell)
    return cell
  })
  document.querySelector('#history')!.prepend(row)
  document.querySelector<HTMLElement>('#history-empty')!.hidden = true
  return (outcome: string) => {
    cells[2]!.textContent = outcome
    cells[3]!.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`
  }
}
function start(event: MouseEvent, launch: HTMLAnchorElement, platform: PlatformId) {
  if (!client || launch.getAttribute('aria-disabled') === 'true') {
    event.preventDefault()
    return
  }
  const id = crypto.randomUUID()
  const finishRun = beginRun(platform)
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
      LedgerId.decode('test:testnet'),
      platform,
      sha256(new TextEncoder().encode('libid/ceremony/dev')),
      new TextEncoder().encode('Ceremony development walkthrough'),
    )
  } catch {
    event.preventDefault()
    status.textContent = 'Could not start the ceremony. Close any remaining popup and retry.'
    window.result = { status: 'failed' }
    result.textContent = 'No ceremony started.'
    finishRun('Failed to start')
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
  const off = ceremony.onEvent(({ stage, platformStep }) => {
    status.textContent =
      stage === 'authorization'
        ? 'Complete authorization in the popup.'
        : `Generating proof${platformStep ? `: ${platformStep.label}` : '…'}`
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
      finishRun(outcome.status === 'denied' ? 'Denied' : 'Proof received')
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
      finishRun(
        cancelled
          ? 'Cancelled'
          : error instanceof CeremonyError
            ? `Failed (${error.code})`
            : 'Failed',
      )
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
