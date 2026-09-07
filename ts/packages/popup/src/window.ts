// The popup lifecycle object. `open` captures the application's retained
// handle (or its absence, for the native-anchor path); `current` captures the
// popup document, its opener, and the matching Service Worker registration.
// Everything but `opened` is package-internal and reached through
// PopupConnection so continuity and control rules always apply.

import { activeRegistration } from './keeper.js'

export interface CurrentOptions {
  /**
   * The exact scope of the host's continuity worker registration, resolved
   * against the current document and same-origin. Without it the
   * registration controlling the document is used, which on an origin with
   * nested registrations may not be the one the host keeps ports in.
   */
  scope?: string
}

/** @internal The listening surface of a Window, injectable for unit tests. */
export interface View {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

function usable(handle: WindowProxy | null): handle is WindowProxy {
  if (handle === null) return false
  try {
    return !handle.closed
  } catch {
    return false
  }
}

export class PopupWindow {
  protected constructor() {}

  /**
   * Synchronously attempts `window.open('about:blank', target, 'popup,…')`.
   * The popup is always requested as a separate window; `features` may add
   * size or position and MUST NOT sever the opener.
   */
  static open(target: string, features = ''): PopupWindow {
    if (target === '' || target.startsWith('_')) {
      throw new TypeError('popup target must be a nonempty name not beginning with "_"')
    }
    if (/\b(noopener|noreferrer)\b/i.test(features)) {
      throw new TypeError('popup features must not sever the opener')
    }
    const windowFeatures = features === '' ? 'popup' : `popup,${features}`
    return new OpenedWindow(window.open('about:blank', target, windowFeatures), window)
  }

  /**
   * Adopts the current popup document; creates nothing. `fragment` is the
   * document's URL fragment as the host captured it, for a bootstrap that
   * clears the URL before importing the package; it defaults to the current
   * `location.hash`. The package treats it as opaque and keeps a snapshot.
   * `scope` selects the exact registration continuity goes through; it need
   * not exist yet.
   */
  static current(fragment?: string, options: CurrentOptions = {}): PopupWindow {
    if (window.top !== window) throw new TypeError('current requires a top-level popup document')
    const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    let scope: string | undefined
    if (options.scope !== undefined) {
      const resolved = new URL(options.scope, window.location.href)
      if (resolved.origin !== window.location.origin) {
        throw new TypeError('worker scope must be same-origin')
      }
      scope = resolved.href
    }
    // getRegistration answers with the registration controlling the given
    // URL; only the exact scope counts, never a shorter one that also matches.
    const registration = async (): Promise<ServiceWorkerRegistration | undefined> => {
      const found = await container?.getRegistration(scope).catch(() => undefined)
      return found && (scope === undefined || found.scope === scope) ? found : undefined
    }
    return new CurrentWindow(
      window,
      registration,
      () => activeRegistration(registration),
      fragment ?? window.location.hash,
    )
  }

  get opened(): boolean {
    return false
  }
}

/** @internal */
export class OpenedWindow extends PopupWindow {
  handle: WindowProxy | null
  /** One-shot: a second `connect` over the same object throws. */
  connected = false

  constructor(
    handle: WindowProxy | null,
    readonly view: View,
  ) {
    super()
    this.handle = handle
  }

  override get opened(): boolean {
    return this.handle !== null
  }

  /** Direct control: a retained handle that does not report closed. */
  get direct(): boolean {
    return usable(this.handle)
  }

  bind(source: WindowProxy): void {
    if (this.handle !== null) throw new Error('popup already bound')
    this.handle = source
  }

  replace(url: string): void {
    this.handle?.location.replace(url)
  }

  closeHandle(): void {
    try {
      this.handle?.close()
    } catch {
      // A discarded browsing context makes closure best-effort.
    }
  }
}

/** @internal */
export class CurrentWindow extends PopupWindow {
  constructor(
    readonly view: Window,
    /** The registration whose scope matches this document, resolved per use. */
    readonly registration: () => Promise<ServiceWorkerRegistration | undefined>,
    /** Settles once a matching registration is active; may never settle. */
    readonly readyRegistration: () => Promise<ServiceWorkerRegistration | undefined> = () =>
      Promise.resolve(undefined),
    fragment = '',
  ) {
    super()
    this.fragment = fragment.startsWith('#') ? fragment.slice(1) : fragment
  }

  /** The captured fragment without its `#`; immutable once adopted. */
  readonly fragment: string

  override get opened(): boolean {
    return true
  }

  /** Whether this document is cross-origin isolated, by any policy. */
  get isolated(): boolean {
    return this.view.crossOriginIsolated === true
  }

  /** The opener while it is usable; a closed opener counts as absent. */
  get opener(): WindowProxy | null {
    const opener = this.view.opener as WindowProxy | null
    return usable(opener) ? opener : null
  }
}
