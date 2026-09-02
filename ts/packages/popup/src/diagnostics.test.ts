import { describe, expect, it, vi } from 'vitest'
import { createReporter, type PopupDiagnostic, reportUndeliverable } from './diagnostics.js'

describe('diagnostics [POPUP-DIAGNOSTIC-001/002]', () => {
  it('emits only code, timestamp, and a nonnegative duration', () => {
    const events: PopupDiagnostic[] = []
    const report = createReporter((event) => void events.push(event))
    report('window-opened')
    report('keep-acknowledged', { durationMs: -3 })
    expect(Object.keys(events[0])).toEqual(['code', 'timestamp'])
    expect(events[0].timestamp).toBeGreaterThan(performance.timeOrigin)
    expect(events[1]).toMatchObject({ code: 'keep-acknowledged', durationMs: 0 })
  })

  it('treats a throwing sink and a broken console as inert', () => {
    const report = createReporter(() => {
      throw new Error('sink failure')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console failure')
    })
    expect(() => report('window-opened')).not.toThrow()
    expect(() => reportUndeliverable(report, 'decode-rejected')).not.toThrow()
    expect(error).toHaveBeenCalledWith('[@libid/popup] decode-rejected')
    error.mockRestore()
  })

  it('is a no-op without a sink', () => {
    expect(() => createReporter(undefined)('window-opened')).not.toThrow()
  })
})
