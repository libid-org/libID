import { CeremonyStage, type Events } from '../../events.js'
import { proofProgress } from './progress.js'

/** Package-owned DOM: no remote resources, application markup, or styling inputs. */
export function view(title: string) {
  const root = document.getElementById('libid-root')
  if (!root) throw new Error('Missing ceremony root')
  root.replaceChildren()
  root.style.cssText =
    'max-width:26rem;margin:18vh auto;padding:2rem;font:16px system-ui;color:#242038;text-align:center'
  const logo = document.createElement('div')
  logo.textContent = 'libID'
  logo.setAttribute('aria-label', 'libID')
  logo.style.cssText = 'font-size:2rem;font-weight:750;letter-spacing:-.06em;margin-bottom:2rem'
  const label = document.createElement('p')
  label.textContent = title
  label.setAttribute('role', 'status')
  root.append(logo, label)
  return { root, label }
}

/** The same local projection as the Application; subscriptions never mediate wire delivery. */
export function eventView(events: Events, platform: string) {
  const { root, label } = view('Preparing your ceremony')
  const bar = document.createElement('progress')
  bar.setAttribute('aria-label', 'Ceremony in progress')
  bar.style.cssText = 'width:100%;accent-color:#6556d8'
  root.append(bar)
  const style = document.createElement('style')
  style.textContent =
    'progress::-webkit-progress-value{transition:width .3s}progress::-moz-progress-bar{transition:width .3s}progress[value="1"]::-webkit-progress-value{transition:none}progress[value="1"]::-moz-progress-bar{transition:none}@media(prefers-reduced-motion:reduce){progress::-webkit-progress-value{transition:none}progress::-moz-progress-bar{transition:none}}'
  const hint = document.createElement('p')
  hint.setAttribute('role', 'status')
  let timer: ReturnType<typeof setTimeout> | undefined
  let offProgress = () => {}
  const off = events.onStage((event) => {
    if (
      event.status === 'active' &&
      event.stage !== 'preparation' &&
      event.stage !== 'authorization' &&
      timer === undefined
    )
      timer = setTimeout(() => {
        hint.textContent =
          'Still proving. In Vanadium, enabling JavaScript JIT in site controls may help.'
        root.append(hint)
      }, 15000)
    label.textContent =
      event.status === 'active'
        ? CeremonyStage.message(event.stage, platform)
        : event.status === 'completed'
          ? 'Proof received'
          : event.status === 'denied'
            ? 'Authorization declined. Return to your application.'
            : `${event.message ?? 'Ceremony failed.'} Return to your application.`
    if (event.status !== 'active') {
      clearTimeout(timer)
      hint.remove()
      bar.remove()
      style.remove()
    }
  })
  return {
    /** ProveIdentity supplies the platform before any pipeline events are produced. */
    trackProof(platformId: string) {
      offProgress()
      bar.max = 1
      bar.value = 0
      root.append(style)
      const progress = proofProgress(platformId)
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
        const timeout = setTimeout(finish, 100)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(finish)
        })
      })
    },
    /** Local delivery updates the label, without emitting or claiming Application acceptance. */
    delivered() {
      bar.value = 1
      label.textContent = 'Proof delivered. Return to your application.'
    },
    stop() {
      off()
      offProgress()
      style.remove()
      clearTimeout(timer)
      hint.remove()
    },
    message(text: string) {
      label.textContent = text
    },
  }
}
