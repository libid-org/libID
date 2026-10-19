import { describe, expect, it } from 'vitest'
import { decimalUserId } from './validation.js'

describe('decimalUserId [TEST-PLAT-02]', () => {
  it.each(['1', '0', '0123', '2244994945', '18446744073709551616', '9'.repeat(20)])(
    'accepts %s as sent',
    (id) => expect(decimalUserId.valid(id)).toBe(true),
  )

  it.each(['', '9'.repeat(21), ' 1', '1 ', '+1', '-1', '1.0', '1e3', 'x1'])('refuses %j', (id) =>
    expect(decimalUserId.valid(id)).toBe(false),
  )
})
