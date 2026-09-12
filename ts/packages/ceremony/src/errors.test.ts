import type { Message, PopupConnection } from '@libid/popup'
import { expect, it, vi } from 'vitest'
import { Abort } from './ccdp/index.js'
import { CeremonyError, ceremonyError, errorMessage, reportFailure } from './errors.js'

it('preserves unexpected error text and context without serializing the exception [LIBID-OAUTH-022]', () => {
  const cause = new Error('Invalid GitHub id')
  const error = ceremonyError(cause, 'identity-fetch')
  expect(error.cause).toBe(cause)
  expect(ceremonyError(error, 'prover')).toBe(error)
  const send = vi.fn()
  reportFailure({ send } as unknown as PopupConnection<Message>, error)
  const message = send.mock.calls[0][0]
  expect(Abort.decode(message)).toBe(message)
  expect(message).toEqual({ type: 'abort', event: 'identity-fetch', message: 'Invalid GitHub id' })
  expect(Abort.decode({ ...message, message: 'A new dependency error' }).message).toBe(
    'A new dependency error',
  )
  for (const extra of [{ cause }, { stack: cause.stack }, { code: 'fixed' }])
    expect(() => Abort.decode({ ...message, ...extra })).toThrow()
})

it('bounds display text and rejects arbitrary objects instead of stringifying their contents', () => {
  expect(errorMessage({ secret: 'value' })).toBe('Ceremony failed.')
  expect(errorMessage(new Error('bad\nvalue\0'))).toBe('bad value')
  const long = errorMessage(new Error('💥'.repeat(2048)))
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(2048)
  expect(long.length).toBeGreaterThan(0)
})

it('records undeliverable failures without logging opaque text or changing outcomes', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const error = new CeremonyError('proof', 'synthetic-secret')
    reportFailure(undefined, error)
    expect(log).toHaveBeenCalledExactlyOnceWith('[ceremony] failure report unavailable')
    log.mockClear()
    reportFailure(
      {
        send() {
          throw new Error('connection closed')
        },
      } as unknown as PopupConnection<Message>,
      error,
    )
    expect(log).toHaveBeenCalledOnce()
    log.mockImplementation(() => {
      throw new Error('logger failed')
    })
    expect(() => reportFailure(undefined, error)).not.toThrow()
  } finally {
    log.mockRestore()
  }
})
