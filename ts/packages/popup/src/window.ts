// The popup lifecycle object. `open` captures the application's retained
// handle (or its absence, for the native-anchor path); `current` captures the
// popup document, its opener, and the matching Service Worker registration.
// Everything but `opened` is package-internal and reached through
// PopupConnection so continuity and control rules always apply.

/** The listening surface of a Window, injectable for unit tests. */
export interface View {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export class PopupWindow {
  /** @internal */
  protected constructor() {}

  /** Synchronously attempts `window.open('about:blank', target)`. */
  static open(target: string): PopupWindow {
    if (target === '' || target.startsWith('_')) {
      throw new TypeError('popup target must be a nonempty name not beginning with "_"')
    }
    return new OpenedWindow(window.open('about:blank', target), window)
  }

  /** Adopts the current popup document; creates nothing. */
  static current(): PopupWindow {
    const registration =
      typeof navigator !== 'undefined' && navigator.serviceWorker
        ? navigator.serviceWorker.getRegistration().catch(() => undefined)
        : Promise.resolve(undefined)
    return new CurrentWindow(window, registration)
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
    return this.handle !== null && !this.handle.closed
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
    readonly registration: Promise<ServiceWorkerRegistration | undefined>,
  ) {
    super()
  }

  override get opened(): boolean {
    return true
  }

  /** The opener while it is usable; a closed opener counts as absent. */
  get opener(): WindowProxy | null {
    const opener = this.view.opener as WindowProxy | null
    return opener !== null && !opener.closed ? opener : null
  }
}
