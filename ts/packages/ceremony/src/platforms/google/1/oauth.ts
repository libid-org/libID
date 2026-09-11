import type { OAuthReturn } from '../../../ccdp/navigation.js'

export type GoogleOAuthOutcome =
  | { outcome: 'accepted'; state: string; idToken: string }
  | { outcome: 'denied'; state: string }
  | { outcome: 'error'; state: string; error: string }

// Ignore provider metadata; unexpected credentials still violate the ID-token profile.
const FIELD = /^([A-Za-z0-9_.-]{1,64})=(.*)$/
const MAX_FIELD_VALUE = 8192
const PRINTABLE_VALUE = /^[\x20-\x7e]*$/

function parseFields(component: string): Map<string, string> | null {
  const fields = new Map<string, string>()
  if (component === '') return fields
  for (const part of component.split('&')) {
    const match = FIELD.exec(part)
    if (!match) return null
    const [, key, value] = match
    if (['code', 'access_token', 'refresh_token'].includes(key)) return null
    if (fields.has(key)) return null
    if (value.length > MAX_FIELD_VALUE || !PRINTABLE_VALUE.test(value)) return null
    try {
      decodeURIComponent(value.replace(/\+/g, ' '))
    } catch {
      return null
    }
    fields.set(key, value)
  }
  return fields
}

/** Parse Google's exact fragment-only accepted, denied, or error return. */
export function parseOAuthReturn(oauthReturn: OAuthReturn): GoogleOAuthOutcome | null {
  if (oauthReturn.query !== '' || !oauthReturn.fragment.startsWith('#')) return null
  const fields = parseFields(oauthReturn.fragment.slice(1))
  if (!fields) return null
  const state = fields.get('state')
  if (!state) return null
  const idToken = fields.get('id_token')
  const error = fields.get('error')
  if (idToken !== undefined && error !== undefined) return null
  if (idToken !== undefined) {
    return idToken ? { outcome: 'accepted', state, idToken } : null
  }
  if (!error) return null
  return error === 'access_denied'
    ? { outcome: 'denied', state }
    : { outcome: 'error', state, error }
}
