// Sanitized local diagnostics (METRICS.md): a stable code, a timestamp, and
// at most a duration. Never an origin, URL, id, payload, or error. Failures
// cross the API as PopupError carrying the same stable code.

export interface PopupDiagnostic {
  readonly code: string
  readonly timestamp: number
  readonly durationMs?: number
  readonly count?: number
}

/** The codes an operation or the connection's terminal outcome can carry. */
export type PopupErrorCode =
  | 'handshake-rejected'
  | 'opener-timeout'
  | 'fallback-unavailable'
  | 'fallback-failed'
  | 'decode-rejected'
  | 'control-rejected'
  | 'continuity-unsupported'
  | 'keep-failed'
  | 'claim-failed'
  | 'popup-unavailable'
  | 'send-unavailable'
  | 'connection-closed'

export type DiagnosticCode =
  | PopupErrorCode
  | 'window-opened'
  | 'window-blocked'
  | 'window-bound'
  | 'carrier-message-port'
  | 'carrier-restored'
  | 'carrier-fallback'
  | 'control-direct'
  | 'control-connected'
  | 'keep-acknowledged'
  | 'claim-empty'
  | 'connection-failed'

export class PopupError extends Error {
  readonly code: PopupErrorCode

  constructor(code: PopupErrorCode) {
    super(code)
    this.name = 'PopupError'
    this.code = code
  }
}

export type Reporter = (code: DiagnosticCode, durationMs?: number) => void

export function createReporter(onDiagnostic?: (event: PopupDiagnostic) => void): Reporter {
  if (!onDiagnostic) return () => {}
  return (code, durationMs) => {
    const event: PopupDiagnostic = {
      code,
      timestamp: performance.timeOrigin + performance.now(),
      ...(durationMs !== undefined && { durationMs: Math.max(0, durationMs) }),
    }
    try {
      onDiagnostic(event)
    } catch {
      // The sink is advisory; its failure never changes connection behavior.
    }
  }
}

/** One sanitized console line for a failure no caller operation can carry. */
export function reportUndeliverable(report: Reporter, code: DiagnosticCode): void {
  try {
    console.error(`[@libid/popup] ${code}`)
  } catch {
    // Console failure is inert.
  }
  report(code)
}
