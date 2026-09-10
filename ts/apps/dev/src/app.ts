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
const platform = document.querySelector<HTMLSelectElement>('#platform')!
const launch = document.querySelector<HTMLAnchorElement>('#launch')!
const connect = document.querySelector<HTMLButtonElement>('#connect')!
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
let connecting = false
function controls() {
  const ready = !!client?.enabledPlatforms.length && !active && !connection && !connecting
  platform.disabled = !ready
  launch.setAttribute('aria-disabled', String(!ready))
  launch.tabIndex = ready ? 0 : -1
  connect.disabled = connecting || !!connection
  cancel.disabled = !active
  close.disabled = !connection
}
async function reconnect() {
  connecting = true
  client = undefined
  controls()
  status.textContent = 'Connecting to the Bridge…'
  try {
    client = await createCeremonyClient({ oauthBridge: settings.bridge })
    platform.replaceChildren(...client.enabledPlatforms.map((id) => new Option(names[id], id)))
    status.textContent = client.enabledPlatforms.length
      ? 'Ready. Choose a platform and start a ceremony.'
      : 'The Bridge has no compatible platforms enabled.'
  } catch {
    platform.replaceChildren(new Option('Bridge unavailable', ''))
    status.textContent =
      'Could not load Bridge configuration. Check its address, certificate and application allowlist, then retry.'
  } finally {
    connecting = false
    controls()
  }
}
connect.addEventListener('click', () => void reconnect())
launch.addEventListener('click', (event) => {
  if (!client || launch.getAttribute('aria-disabled') === 'true') {
    event.preventDefault()
    return
  }
  const id = crypto.randomUUID()
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
      platform.value as PlatformId,
      sha256(new TextEncoder().encode('libid/ceremony/dev')),
      new TextEncoder().encode('Ceremony development walkthrough'),
    )
  } catch {
    event.preventDefault()
    status.textContent = 'Could not start the ceremony. Close any remaining popup and retry.'
    window.result = { status: 'failed' }
    result.textContent = 'No ceremony started.'
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
  void current.closed.then(() => {
    if (connection === current) connection = undefined
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
      window.result = { status: cancelled ? 'cancelled' : 'failed' }
      result.textContent = cancelled
        ? 'Ceremony cancelled.'
        : error instanceof CeremonyError
          ? `${error.message} (${error.code}) Close the popup and start a fresh attempt.`
          : 'Ceremony failed. Close the popup and start a fresh attempt.'
      status.textContent = 'Ceremony stopped.'
    })
    .finally(() => {
      off()
      active = undefined
      controls()
    })
})
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
void reconnect()
