import type { Node } from 'estree'

export type Edit = readonly [start: number, end: number, replacement: string]

// Rollup supplies offsets on every parsed node; ESTree's base types omit them.
export const span = (node: Node) => node as Node & { start: number; end: number }

export function replacement(node: Node, text: string): Edit {
  return [span(node).start, span(node).end, text]
}

/** Visit every node depth-first, parents before children and in source order. */
export function walk(value: unknown, visit: (node: Node) => void): void {
  if (!value || typeof value !== 'object') return
  if (!Array.isArray(value)) visit(value as Node)
  for (const child of Object.values(value)) walk(child, visit)
}

/** Apply non-overlapping edits back to front, so pending offsets stay valid. */
export function applyEdits(code: string, edits: Edit[]): string {
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
    code = code.slice(0, start) + text + code.slice(end)
  return code
}
