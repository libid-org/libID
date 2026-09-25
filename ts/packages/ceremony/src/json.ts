/** Native JSON parsing plus duplicate-key detection, including escaped aliases. */
export function parseJson(source: string): unknown {
  const value: unknown = JSON.parse(source)
  const stack: ({ keys: Set<string>; key: boolean } | null)[] = []
  for (const [token] of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/g)) {
    const top = stack.at(-1)
    if (token === '{') stack.push({ keys: new Set(), key: true })
    else if (token === '[') stack.push(null)
    else if (token === '}' || token === ']') stack.pop()
    else if (token === ',') {
      if (top) top.key = true
    } else if (token === ':') {
      if (top) top.key = false
    } else if (top?.key) {
      const key = JSON.parse(token) as string
      if (top.keys.has(key)) throw new TypeError('Duplicate JSON member')
      top.keys.add(key)
      top.key = false
    }
    if (stack.length > 32) throw new TypeError('JSON nesting limit exceeded')
  }
  return value
}
