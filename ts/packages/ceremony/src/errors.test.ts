import { PopupError } from '@libid/popup'
import { fakeConnection } from '@libid/popup/testing'
import { expect, it, vi } from 'vitest'
import { CeremonyFailed } from './ccdp/index.js'
import { popupErrorMessages } from './ccdp/ui-messages.js'
import { CeremonyError, ceremonyError, errorMessage, reportFailure } from './errors.js'

it('preserves unexpected error text and context without serializing the exception [LIBID-OAUTH-022] [LIBID-OAUTH-030]', () => {
  const cause = new Error('Invalid GitHub id')
  const error = ceremonyError(cause, 'identity-fetch')
  expect(error.cause).toBe(cause)
  expect(ceremonyError(error, 'prover')).toBe(error)
  const connection = fakeConnection({ peerOrigin: 'https://app.test' })
  reportFailure(connection, error)
  expect(connection.sent).toEqual([
    { type: 'ceremony-failed', event: 'identity-fetch', message: 'Invalid GitHub id' },
  ])
  const [message] = connection.sent
  expect(CeremonyFailed.decode(message)).toBe(message)
  expect(CeremonyFailed.decode({ ...message, message: 'A new dependency error' }).message).toBe(
    'A new dependency error',
  )
  for (const extra of [{ cause }, { stack: cause.stack }, { code: 'fixed' }])
    expect(() => CeremonyFailed.decode({ ...message, ...extra })).toThrow()
})

it('bounds display text and rejects arbitrary objects instead of stringifying their contents [LIBID-OAUTH-030]', () => {
  expect(errorMessage({ secret: 'value' })).toBe('Ceremony failed.')
  expect(errorMessage(new Error('bad\nvalue\0'))).toBe('bad value')
  expect(errorMessage(new Error('💥'.repeat(2048)))).toBe('💥'.repeat(512))
  const long = errorMessage(new Error(`a${'💥'.repeat(600)}`))
  expect(long).toBe(`a${'💥'.repeat(511)}`)
  expect(new TextDecoder().decode(new TextEncoder().encode(long))).toBe(long)
  expect(new CeremonyError('proof', `a${'💥'.repeat(600)}`).message).toBe(long)
  // Nothing displayable left after cleaning falls back to the generic text.
  for (const empty of ['', ' ', '\n\0'])
    expect(errorMessage(new Error(empty))).toBe('Ceremony failed.')
})

it('records undeliverable failures without logging opaque text or changing outcomes [TEST-CCDP-08] [LIBID-OAUTH-029] [LIBID-OAUTH-030]', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const error = new CeremonyError('proof', 'synthetic-secret')
    reportFailure(undefined, error)
    expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
    log.mockClear()
    const closed = fakeConnection({ peerOrigin: 'https://app.test' })
    vi.spyOn(closed, 'send').mockImplementation(() => {
      throw new Error('connection closed')
    })
    reportFailure(closed, error)
    expect(log).toHaveBeenCalledOnce()
    log.mockClear()
    // An unauthenticated or pattern-admitted peer never receives the failure.
    for (const peerOrigin of [null, 'null', '*', 'https://app.test/']) {
      const connection = fakeConnection({ peerOrigin })
      reportFailure(connection, error)
      expect(connection.sent).toEqual([])
    }
    expect(log).toHaveBeenCalledTimes(4)
    log.mockImplementation(() => {
      throw new Error('logger failed')
    })
    expect(() => reportFailure(undefined, error)).not.toThrow()
  } finally {
    log.mockRestore()
  }
})

it('translates popup codes into CCDP copy while preserving the transport cause', () => {
  const cause = new PopupError('fallback-unavailable')
  const error = ceremonyError(cause, 'authorization')
  expect(cause.message).toBe('fallback-unavailable')
  expect(error.cause).toBe(cause)
  expect(error.event).toBe('authorization')
  expect(error.message).toBe(popupErrorMessages['fallback-unavailable'])
  expect(error.message).toContain('The sign-in provider may have isolated this window')
  // Matching text in an ordinary exception is not a transport code.
  expect(errorMessage(new Error('fallback-unavailable'))).toBe('fallback-unavailable')
})
