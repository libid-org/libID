import type { OAuthReturn } from '../ccdp/navigation.js'

export type CodeOAuthOutcome =
  | { outcome: 'accepted'; state: string; code: string }
  | { outcome: 'denied'; state: string }
  | { outcome: 'error'; state: string; error: string }

const FIELD = /^([A-Za-z0-9_.-]{1,64})=(.*)$/
const VALUE = /^[\x20-\x7e]+$/

/** Decode provider form values without requiring one particular percent-encoding spelling. */
export function parseCodeOAuthReturn(
  oauthReturn: OAuthReturn,
  expectedIssuer?: string,
): CodeOAuthOutcome | null {
  if (
    oauthReturn.fragment !== '' ||
    !oauthReturn.query.startsWith('?') ||
    oauthReturn.query.length > 32768
  )
    return null
  const fields = new Map<string, string>()
  for (const part of oauthReturn.query.slice(1).split('&')) {
    const match = FIELD.exec(part)
    if (!match) return null
    const [, key, raw] = match
    if (
      ['id_token', 'access_token', 'refresh_token'].includes(key) ||
      (key === 'iss' && !expectedIssuer)
    )
      return null
    if (fields.has(key)) return null
    let value: string
    try {
      value = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
      return null
    }
    if (value.length > 8192) return null
    // Metadata has no value schema; only fields used by this profile are interpreted.
    if (['state', 'code', 'error', 'iss'].includes(key) && !VALUE.test(value)) return null
    fields.set(key, value)
  }
  if (expectedIssuer && fields.get('iss') !== expectedIssuer) return null
  const state = fields.get('state'),
    code = fields.get('code'),
    error = fields.get('error')
  if (!state || (code === undefined) === (error === undefined)) return null
  if (code !== undefined) return { outcome: 'accepted', state, code }
  return error === 'access_denied'
    ? { outcome: 'denied', state }
    : { outcome: 'error', state, error: error! }
}
