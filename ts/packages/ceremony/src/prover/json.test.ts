import { expect, it } from 'vitest'
import { parseJson, parseJsonNumbersAsText } from './json.js'
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

it('preserves numeric root identity IDs without accepting quoted or rounded aliases', () => {
  expect(parseJsonNumbersAsText('{"id":18446744073709551615}')).toEqual({
    id: 18446744073709551615n,
  })
  expect(parseJsonNumbersAsText('{"\\u0069d":"1","nested":{"id":1}}')).toEqual({
    id: '1',
    nested: { id: '1' },
  })
  expect(
    parseJsonNumbersAsText('{"\\u0069d":9007199254740992,"nested":{"id":9007199254740993}}'),
  ).toEqual({ id: 9007199254740992n, nested: { id: '9007199254740993' } })
  expect(() => parseJsonNumbersAsText('{"id":01}')).toThrow()
  expect(() => parseJsonNumbersAsText('{"id":1,2:3}')).toThrow()
})
