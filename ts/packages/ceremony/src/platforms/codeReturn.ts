import type { OAuthReturn } from '../ccdp/navigation.js'

export type CodeOAuthOutcome =
  | { outcome: 'accepted'; state: string; code: string }
  | { outcome: 'denied'; state: string }
  | { outcome: 'error'; state: string; error: string }

const FIELD = /^([A-Za-z][A-Za-z0-9_]{0,63})=(.*)$/
const VALUE = /^[\x20-\x7e]{1,8192}$/

/** Parse the exact query-only OAuth code return shared by X and GitHub. */
export function parseCodeOAuthReturn(oauthReturn: OAuthReturn): CodeOAuthOutcome | null {
  if (oauthReturn.fragment !== '' || !oauthReturn.query.startsWith('?')) return null
  const raw = oauthReturn.query.slice(1)
  const fields = new Set<string>()
  for (const part of raw.split('&')) {
    const match = FIELD.exec(part)
    if (!match) return null
    const [, key] = match
    if (key !== 'state' && key !== 'code' && key !== 'error') return null
    if (fields.has(key)) return null
    fields.add(key)
  }
  // Round-tripping rejects encoded field aliases and noncanonical percent
  // escapes while returning the decoded provider values.
  const parsed = new URLSearchParams(raw)
  if (parsed.toString() !== raw) return null
  const state = parsed.get('state')
  const code = parsed.get('code')
  const error = parsed.get('error')
  if (!state || !VALUE.test(state)) return null
  if ((code === null) === (error === null)) return null
  if (code !== null) return VALUE.test(code) ? { outcome: 'accepted', state, code } : null
  if (!error || !VALUE.test(error)) return null
  return error === 'access_denied'
    ? { outcome: 'denied', state }
    : { outcome: 'error', state, error }
}
