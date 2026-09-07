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
export function progressView() {
  const { root, label } = view('Preparing proof'),
    bar = document.createElement('progress')
  bar.max = 1
  bar.value = 0
  bar.setAttribute('aria-label', 'Proof progress')
  bar.style.cssText = 'width:100%;accent-color:#6556d8'
  root.append(bar)
  const style = document.createElement('style')
  style.textContent =
    'progress::-webkit-progress-value{transition:width .3s}progress::-moz-progress-bar{transition:width .3s}.libid-activity{height:2px;background:linear-gradient(90deg,transparent,#6556d8,transparent);animation:libid-shimmer 1.5s linear infinite}@keyframes libid-shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}@media(prefers-reduced-motion:reduce){.libid-activity{animation:none}}'
  const activity = document.createElement('div')
  activity.className = 'libid-activity'
  activity.setAttribute('aria-hidden', 'true')
  root.style.overflow = 'hidden'
  root.append(style, activity)
  const hint = document.createElement('p')
  hint.setAttribute('role', 'status')
  root.append(hint)
  const timer = setTimeout(() => {
    hint.textContent =
      'Still proving. In Vanadium, enabling JavaScript JIT in site controls may help.'
  }, 15000)
  return {
    update(value: number, text: string) {
      bar.value = value
      label.textContent = text
    },
    stop() {
      clearTimeout(timer)
      hint.remove()
      activity.remove()
      style.remove()
    },
  }
}
