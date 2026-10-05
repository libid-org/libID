// The ENS name of a libID handle, as specs/ens-integration.md §5 and §6 define
// it. A name is derived from the handle alone: nothing is registered, and the
// gateway reads the handle back out of the labels.
import { normalize, rulesFor } from '@libid/contracts'

/** The ENS name every libID name sits under. */
export const PARENT_NAME = 'handles.link'

/** The platforms with a label of their own. The label is the platform's key. */
export type Platform = 'github' | 'x' | 'google'

const PLATFORMS: readonly string[] = ['github', 'x', 'google']
const CHAIN_LABEL = /^[a-z0-9-]+$/
const LABEL = /^[a-z0-9-]+$/
const GMAIL_LOCAL = /^[a-z0-9]+(\.[a-z0-9]+)*$/
/** A DNS label's ceiling (RFC 1035), which the gateway enforces. */
const MAX_LABEL = 63

export interface NameOptions {
  /**
   * A chain label, such as `base`. A name with one is answered only for that
   * chain; without one, for whichever chain the wallet asks about. The labels a
   * gateway knows are deployment data, so this only checks the label's shape.
   */
  chain?: string
}

/**
 * The ENS name of `handle` on `platform`, or `null` when the handle has no
 * name. A handle with no name stays reachable through the registry and by its
 * holder's address.
 *
 * `handle` is taken as a user typed it and normalized with the registry's
 * rules first, so `@Some_User` and `some_user` give one name. Text that is not
 * a handle on the platform at all throws the `HandleError` of
 * `@libid/contracts`.
 */
export function ensName(
  platform: Platform,
  handle: string,
  options: NameOptions = {},
): string | null {
  const labels = handleLabels(platform, normalized(platform, handle))
  if (labels === null) return null
  const chain = options.chain === undefined ? [] : [chainLabel(options.chain)]
  return [...labels, platform, ...chain, PARENT_NAME].join('.')
}

/**
 * The labels a normalized handle becomes, before the platform label (REQ-ENS-LABEL-01
 * to -04), or `null` when the handle has none.
 */
export function handleLabels(platform: Platform, handle: string): string[] | null {
  const labels = platformLabels(platform, handle)
  return labels?.every((label) => label.length <= MAX_LABEL) ? labels : null
}

function platformLabels(platform: Platform, handle: string): string[] | null {
  switch (platform) {
    case 'x':
      return xLabels(handle)
    case 'github':
      return LABEL.test(handle) ? [handle] : null
    case 'google':
      return googleLabels(handle)
  }
}

/** X issues no `-`, so `_` becomes `-` and comes back; `__` at the 3rd and 4th characters is ENSIP-15's `xn--` reserve. */
function xLabels(handle: string): string[] | null {
  if (handle[2] === '_' && handle[3] === '_') return null
  const label = handle.replaceAll('_', '-')
  return LABEL.test(label) ? [label] : null
}

/** Gmail: the local part's dot-separated pieces. Any other domain: the local part, `_at`, then the domain. */
function googleLabels(handle: string): string[] | null {
  const at = handle.indexOf('@')
  if (at < 0 || handle.indexOf('@', at + 1) >= 0) return null
  const local = handle.slice(0, at)
  const domain = handle.slice(at + 1)
  if (domain === 'gmail.com') return GMAIL_LOCAL.test(local) ? local.split('.') : null
  const labels = [...local.split('.'), '_at', ...domain.split('.')]
  return labels.every((label) => label === '_at' || LABEL.test(label)) ? labels : null
}

function normalized(platform: Platform, handle: string): string {
  const rules = rulesFor(platform)
  if (rules === null) throw new Error(`No handle rules for platform ${platform}`)
  return normalize(handle, rules)
}

function chainLabel(chain: string): string {
  if (!CHAIN_LABEL.test(chain) || PLATFORMS.includes(chain))
    throw new Error(`Not a chain label: ${JSON.stringify(chain)}`)
  return chain
}
