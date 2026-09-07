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

/** Preserve numeric root fields as bigint, without ever rounding an identity ID. */
export function parseJsonNumbersAsText(source: string): unknown {
  const numericRoots = new Map<string, string>()
  let depth = 0
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]]/g)) {
    const token = match[0]
    if (token === '{' || token === '[') depth++
    else if (token === '}' || token === ']') depth--
    else if (depth === 1) {
      const number = /^\s*:\s*(-?(?:0|[1-9][0-9]*))\s*[,}]/.exec(
        source.slice(match.index + token.length),
      )
      if (number) numericRoots.set(JSON.parse(token), number[1])
    }
  }
  const value = parseJson(
    source.replace(
      /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g,
      (token, offset) => {
        if (token.startsWith('"')) return token
        if (/^\s*:/.test(source.slice(offset + token.length)))
          throw new TypeError('Invalid JSON object key')
        return JSON.stringify(token)
      },
    ),
  )
  if (value && typeof value === 'object' && !Array.isArray(value))
    for (const [key, number] of numericRoots)
      Object.defineProperty(value, key, {
        value: BigInt(number),
        enumerable: true,
        writable: true,
        configurable: true,
      })
  return value
}
