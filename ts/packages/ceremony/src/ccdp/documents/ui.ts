import { CeremonyStage, type Events, type StageEvent } from '../../events.js'
import { messages } from '../uiMessages.js'
import { proofProgress } from './progress.js'

const SLOW_PROVING_HINT_MS = 15000
const PAINT_FALLBACK_MS = 100

/** Package-owned DOM: no remote resources, application markup, or styling inputs. */
export function view(title: string) {
  const root = document.getElementById('libid-root')
  if (!root) throw new Error(messages.missingRoot)
  root.replaceChildren()
  root.style.cssText =
    'max-width:26rem;margin:18vh auto;padding:2rem;font:16px system-ui;color:#242038;text-align:center'
  const logo = document.createElement('div')
  logo.textContent = messages.brand
  logo.setAttribute('aria-label', messages.brand)
  logo.style.cssText = 'font-size:2rem;font-weight:750;letter-spacing:-.06em;margin-bottom:2rem'
  const label = document.createElement('p')
  label.textContent = title
  label.setAttribute('role', 'status')
  root.append(logo, label)
  return { root, label }
}

/** Documents never project the authorization stage, so no platform name is needed. */
function stageLabel(event: StageEvent): string {
  if (event.status === 'active') return CeremonyStage.message(event.stage, '')
  if (event.status === 'completed') return messages.proofReceived
  if (event.status === 'denied') return messages.returnToApplication(messages.authorizationDeclined)
  return messages.returnToApplication(
    event.message ?? (event.status === 'closed' ? messages.interrupted : messages.failed),
  )
}

/** The same local projection as the Application; subscriptions never mediate wire delivery. */
export function eventView(events: Events) {
  const { root, label } = view(messages.preparation)
  const bar = document.createElement('progress')
  bar.setAttribute('aria-label', messages.progress)
  bar.style.cssText = 'width:100%;accent-color:#6556d8'
  root.append(bar)
  const style = document.createElement('style')
  style.textContent =
    'progress::-webkit-progress-value{transition:width .3s}progress::-moz-progress-bar{transition:width .3s}progress[value="1"]::-webkit-progress-value{transition:none}progress[value="1"]::-moz-progress-bar{transition:none}@media(prefers-reduced-motion:reduce){progress::-webkit-progress-value{transition:none}progress::-moz-progress-bar{transition:none}}'
  const hint = document.createElement('p')
  hint.setAttribute('role', 'status')
  let timer: ReturnType<typeof setTimeout> | undefined
  let offProgress = () => {}
  const teardown = () => {
    clearTimeout(timer)
    hint.remove()
    style.remove()
  }
  const off = events.onStage((event) => {
    if (
      event.status === 'active' &&
      event.stage !== 'preparation' &&
      event.stage !== 'authorization' &&
      timer === undefined
    )
      timer = setTimeout(() => {
        hint.textContent = messages.slowProving
        root.append(hint)
      }, SLOW_PROVING_HINT_MS)
    label.textContent = stageLabel(event)
    if (event.status !== 'active') {
      teardown()
      bar.remove()
    }
  })
  return {
    /** ProveIdentity supplies the platform before any prover events are produced. */
    trackProof(weights: Readonly<Record<string, number>>) {
      offProgress()
      bar.max = 1
      bar.value = 0
      root.append(style)
      const progress = proofProgress(weights)
      offProgress = events.onEvent((event) => {
        const value = progress(event)
        if (value !== undefined) bar.value = value
      })
    },
    /** Give the full bar a paint opportunity before delivery; hidden documents need no wait. */
    async finishProof() {
      bar.value = 1
      if (document.hidden) return
      await new Promise<void>((resolve) => {
        let frame = 0
        const finish = () => {
          clearTimeout(timeout)
          cancelAnimationFrame(frame)
          resolve()
        }
        // Animation frames can stop if the document becomes hidden.
        const timeout = setTimeout(finish, PAINT_FALLBACK_MS)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(finish)
        })
      })
    },
    /** Local delivery updates the label, without emitting or claiming Application acceptance. */
    delivered() {
      bar.value = 1
      label.textContent = messages.returnToApplication(messages.proofDelivered)
    },
    stop() {
      off()
      offProgress()
      teardown()
    },
    message(text: string) {
      label.textContent = text
    },
  }
}
