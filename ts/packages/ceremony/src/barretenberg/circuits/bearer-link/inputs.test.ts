import { expect, it } from 'vitest'
import { buildBearerLinkInputs } from './inputs.js'

it.each(['', 'a'.repeat(129), 'a'.repeat(4097), 'bad\n', 'a b', 'a\tb', 'é'])(
  'rejects bearers an HTTP Authorization header cannot carry %j [TEST-PLAT-10]',
  (bearer) => {
    const opening = {
      start: 0,
      end: bearer.length,
      blinder: new Uint8Array(16),
      hash: new Uint8Array(32),
    }
    expect(() => buildBearerLinkInputs(bearer, opening, opening)).toThrow(/bearer/)
  },
)
