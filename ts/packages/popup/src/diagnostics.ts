// Sanitized local diagnostics (METRICS.md): a stable code, a timestamp, and
// at most a duration or count. Never an origin, URL, id, payload, or error.

export interface PopupDiagnostic {
  readonly code: string
  readonly timestamp: number
  readonly durationMs?: number
  readonly count?: number
}

export type DiagnosticCode =
  | 'window-opened'
  | 'window-blocked'
  | 'window-bound'
  | 'handshake-rejected'
  | 'opener-timeout'
  | 'carrier-message-port'
  | 'carrier-restored'
  | 'carrier-fallback'
  | 'fallback-unavailable'
  | 'decode-rejected'
  | 'control-rejected'
  | 'control-direct'
  | 'control-connected'
  | 'continuity-unsupported'
  | 'keep-acknowledged'
  | 'keep-failed'
  | 'claim-empty'
  | 'claim-failed'
  | 'popup-unavailable'
  | 'send-unavailable'
  | 'connection-closed'
  | 'connection-failed'

export type Reporter = (code: DiagnosticCode, extra?: { durationMs?: number }) => void

export function createReporter(onDiagnostic?: (event: PopupDiagnostic) => void): Reporter {
  if (!onDiagnostic) return () => {}
  return (code, extra) => {
    const event: PopupDiagnostic = {
      code,
      timestamp: performance.timeOrigin + performance.now(),
      ...(extra?.durationMs !== undefined && { durationMs: Math.max(0, extra.durationMs) }),
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

/** Errors cross the API as plain `Error` whose message is the code. */
export function failure(code: DiagnosticCode): Error {
  return new Error(code)
}

export function codeOf(error: unknown): DiagnosticCode | null {
  return error instanceof Error ? (error.message as DiagnosticCode) : null
}
