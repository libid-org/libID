import type { Message, PopupConnection } from '@libid/popup'
import { expect, it, vi } from 'vitest'
import { AbortCeremony } from './ccdp/index.js'
import { CeremonyError, ceremonyError, reportFailure } from './errors.js'

it('preserves the original local cause but sends only the known code/message', () => {
  const cause = new Error('synthetic-secret-token')
  const error = ceremonyError(cause, 'token-exchange')
  expect(error.cause).toBe(cause)
  expect(ceremonyError(error, 'prover-execution')).toBe(error)
  const send = vi.fn()
  reportFailure({ send } as unknown as PopupConnection<Message>, error)
  const message = send.mock.calls[0][0]
  expect(AbortCeremony.decode(message)).toBe(message)
  expect(message).toEqual({
    type: 'abort-ceremony',
    code: 'token-exchange',
    reason: 'OAuth token exchange or response validation failed.',
  })
  expect(JSON.stringify(message)).not.toContain('secret')
  expect(() => AbortCeremony.decode({ ...message, reason: cause.message })).toThrow()
  expect(() => AbortCeremony.decode({ ...message, cause })).toThrow()
})

it('reports undeliverable failures once without leaking causes or changing outcomes', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const error = new CeremonyError('proof', { cause: new Error('synthetic-secret') })
    reportFailure(undefined, error)
    expect(log).toHaveBeenLastCalledWith('[ceremony] proof')
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
