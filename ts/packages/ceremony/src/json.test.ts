import { expect, it } from 'vitest'
import { parseJson } from './json.js'

it('rejects duplicate/escaped keys without restricting valid JSON [LIBID-PROVER-004]', () => {
  for (const source of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}'.replace('\\\\', '\\'),
    '[{"a":0,"a":1}]',
  ])
    expect(() => parseJson(source)).toThrow()
  const source = ' { "a" : [{"x": 1}, {"x": 2}], "b": "comma, colon: braces{}" } '
  expect(parseJson(source)).toEqual(JSON.parse(source))
})
