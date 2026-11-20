// Ported from libid-server-rs ceremony-tests/src/browser/stealth.js, and
// installed in every page by presentAsPerson (person.ts).
// Runs in every new document before the page's own scripts: what the page
// can read is a person's Chrome on a Mac.

// `navigator.webdriver` is `undefined`, as in a Chrome nobody automates.
Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
Object.defineProperty(Navigator.prototype, 'webdriver', {
  get: () => undefined,
  configurable: true,
})
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' })
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })

// The client hints are the user agent metadata presentAsPerson (person.ts)
// sets over CDP, which Chrome itself reports through `navigator.userAgentData` and the
// `sec-ch-ua` headers.

// `window.chrome`, with the members a page reads off it.
window.chrome = {
  app: {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: function () {
      return null
    },
    getIsInstalled: function () {
      return false
    },
    runningState: function () {
      return 'cannot_run'
    },
  },
  runtime: {
    OnInstalledReason: {
      CHROME_UPDATE: 'chrome_update',
      INSTALL: 'install',
      SHARED_MODULE_UPDATE: 'shared_module_update',
      UPDATE: 'update',
    },
    OnRestartRequiredReason: {
      APP_UPDATE: 'app_update',
      OS_UPDATE: 'os_update',
      PERIODIC: 'periodic',
    },
    PlatformArch: {
      ARM: 'arm',
      ARM64: 'arm64',
      MIPS: 'mips',
      MIPS64: 'mips64',
      X86_32: 'x86-32',
      X86_64: 'x86-64',
    },
    PlatformNaclArch: {
      ARM: 'arm',
      MIPS: 'mips',
      MIPS64: 'mips64',
      X86_32: 'x86-32',
      X86_64: 'x86-64',
    },
    PlatformOs: {
      ANDROID: 'android',
      CROS: 'cros',
      FUCHSIA: 'fuchsia',
      LINUX: 'linux',
      MAC: 'mac',
      OPENBSD: 'openbsd',
      WIN: 'win',
    },
    RequestUpdateCheckStatus: {
      NO_UPDATE: 'no_update',
      THROTTLED: 'throttled',
      UPDATE_AVAILABLE: 'update_available',
    },
    connect: function () {},
    sendMessage: function () {},
  },
  csi: function () {
    return {}
  },
  loadTimes: function () {
    return {}
  },
}

// The PDF viewer plugins a desktop Chrome lists.
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugin = (name, filename, description) => {
      const p = { name, filename, description, length: 1 }
      p[0] = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
      return p
    }
    const plugins = [
      plugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      plugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      plugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      plugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      plugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ]
    plugins.item = (i) => plugins[i] || null
    plugins.namedItem = (n) => plugins.find((p) => p.name === n) || null
    plugins.refresh = () => {}
    return plugins
  },
})
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const types = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ]
    types.item = (i) => types[i] || null
    types.namedItem = (n) => types.find((m) => m.type === n) || null
    return types
  },
})

// The notifications permission answers as `Notification.permission` does.
const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions)
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters)

// WebGL names an Intel GPU.
const getParameter = WebGLRenderingContext.prototype.getParameter
WebGLRenderingContext.prototype.getParameter = function (parameter) {
  if (parameter === 37445) return 'Intel Inc.'
  if (parameter === 37446) return 'Intel Iris OpenGL Engine'
  return getParameter.call(this, parameter)
}

// A 1920x1080 screen with a 1440x900 window on it.
Object.defineProperty(screen, 'width', { get: () => 1920 })
Object.defineProperty(screen, 'height', { get: () => 1080 })
Object.defineProperty(screen, 'availWidth', { get: () => 1920 })
Object.defineProperty(screen, 'availHeight', { get: () => 1080 })
Object.defineProperty(screen, 'colorDepth', { get: () => 24 })
Object.defineProperty(screen, 'pixelDepth', { get: () => 24 })
Object.defineProperty(window, 'outerWidth', { get: () => 1440 })
Object.defineProperty(window, 'outerHeight', { get: () => 900 })
Object.defineProperty(window, 'innerWidth', { get: () => 1440 })
Object.defineProperty(window, 'innerHeight', { get: () => 900 })

// A wired connection, eight cores, eight gigabytes.
Object.defineProperty(navigator, 'connection', {
  get: () => ({
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
  }),
})
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })

// The time zone of the locale.
const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions
Intl.DateTimeFormat.prototype.resolvedOptions = function () {
  const options = resolvedOptions.call(this)
  options.timeZone = 'America/New_York'
  return options
}

// Canvas and audio fingerprints differ from run to run by one step.
const toDataURL = HTMLCanvasElement.prototype.toDataURL
HTMLCanvasElement.prototype.toDataURL = function (type) {
  try {
    const context = this.getContext('2d')
    if (context && this.width > 0 && this.height > 0) {
      const image = context.getImageData(0, 0, this.width, this.height)
      for (let i = 0; i < Math.min(image.data.length, 40); i += 4) {
        image.data[i] = (image.data[i] + 1) & 0xff
      }
      context.putImageData(image, 0, 0)
    }
  } catch (e) {}
  return toDataURL.call(this, type)
}
if (typeof AudioContext !== 'undefined') {
  const getChannelData = AudioBuffer.prototype.getChannelData
  AudioBuffer.prototype.getChannelData = function (channel) {
    const data = getChannelData.call(this, channel)
    if (data.length > 0) data[0] += 0.0000001
    return data
  }
}

// No automation globals on `window`.
for (const key of Object.keys(window)) {
  if (
    key.startsWith('cdc_') ||
    key.startsWith('__playwright') ||
    key.startsWith('__selenium') ||
    key.startsWith('__webdriver') ||
    key.startsWith('__driver_') ||
    key === 'callPhantom' ||
    key === '_phantom' ||
    key === 'domAutomation' ||
    key === 'domAutomationController'
  ) {
    delete window[key]
  }
}

// Stack traces carry no devtools frames.
const prepareStackTrace = Error.prepareStackTrace
Error.prepareStackTrace = function (error, stack) {
  const filtered = stack.filter((frame) => {
    const fn = frame.getFunctionName() || ''
    const file = frame.getFileName() || ''
    return (
      !file.includes('__puppeteer') &&
      !file.includes('pptr:') &&
      !fn.includes('Runtime.evaluate') &&
      !file.includes('devtools') &&
      !file.includes('__chromium') &&
      !file.includes('chrome-extension://') &&
      !file.includes('//# sourceURL=')
    )
  })
  if (prepareStackTrace) return prepareStackTrace(error, filtered)
  return error + '\n' + filtered.map((f) => '    at ' + f).join('\n')
}

// Child frames answer `webdriver` the same way.
const contentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
if (contentWindow) {
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function () {
      const win = contentWindow.get.call(this)
      if (!win) return win
      try {
        Object.defineProperty(win.navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        })
      } catch (e) {}
      return win
    },
  })
}

// The codecs a desktop Chrome plays.
const canPlayType = HTMLMediaElement.prototype.canPlayType
HTMLMediaElement.prototype.canPlayType = function (type) {
  const result = canPlayType.call(this, type)
  if (result === '') {
    if (type === 'video/mp4; codecs="avc1.42E01E"') return 'probably'
    if (type === 'video/mp4; codecs="avc1.4D401E"') return 'probably'
    if (type === 'video/mp4; codecs="avc1.64001E"') return 'probably'
    if (type === 'video/webm; codecs="vp8"') return 'probably'
    if (type === 'video/webm; codecs="vp9"') return 'probably'
    if (type === 'audio/mpeg') return 'probably'
    if (type === 'audio/ogg; codecs="vorbis"') return 'probably'
    if (type === 'audio/mp4; codecs="mp4a.40.2"') return 'probably'
  }
  return result
}

// `performance.now()` carries sub-millisecond noise.
const now = performance.now.bind(performance)
performance.now = function () {
  return now() + Math.random() * 0.1
}
