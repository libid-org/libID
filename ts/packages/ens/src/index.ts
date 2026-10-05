// The ENS name of a libID handle, as §5 and §6 of the ENS integration spec
// define it:
// https://github.com/libid-org/libID/blob/4d778353dc8a03414231253504629f35da539635/specs/ens-integration.md
// A name is derived from the handle alone: nothing is registered, and the
// gateway reads the handle back out of the labels.
import {
  normalize,
  PLATFORM_GITHUB_KEY,
  PLATFORM_GOOGLE_KEY,
  PLATFORM_X_KEY,
  rulesFor,
} from '@libid/contracts/identity'

export { HandleError } from '@libid/contracts/identity'

/** The production deployment's Parent Name (ENS integration spec §2). */
const PARENT_NAME = 'handles.link'

const PLATFORMS = [PLATFORM_GITHUB_KEY, PLATFORM_X_KEY, PLATFORM_GOOGLE_KEY] as const

/** The platforms with a label of their own. The label is the platform's key. */
export type Platform = (typeof PLATFORMS)[number]

const GMAIL_LOCAL = /^[a-z0-9]+(\.[a-z0-9]+)*$/
/** Separates a Workspace address's local part from its domain. */
const AT = '_at'

export interface NameOptions {
  /**
   * A chain label, such as `base`. A name with one is answered only for that
   * chain; without one, for whichever chain the wallet asks about. The labels a
   * gateway knows are deployment data, so this only checks the label's shape
   * and that it is not a platform key. ENS asks the nearest name with a
   * resolver, so a chain label that names a subname with a deployment of its
   * own, such as `testnet`, is answered by that deployment instead.
   */
  chain?: string
  /**
   * The name the gateway answers under, such as `testnet.handles.link`.
   * Defaults to `handles.link`.
   */
  parent?: string
}

/**
 * The ENS name of `handle` on `platform`, or `null` when the handle has no
 * name. A handle with no name stays reachable through the registry and by its
 * holder's address.
 *
 * `handle` is taken as a user typed it and normalized first with the handle
 * rules `@libid/contracts` was released with, which the gateway applies on
 * every chain, so `@Some_User` and `some_user` give one name. Text that is not
 * a handle on the platform at all throws the `HandleError` of
 * `@libid/contracts`.
 */
export function ensName(
  platform: Platform,
  handle: string,
  options?: NameOptions | null,
): string | null {
  if (!PLATFORMS.includes(platform)) throw new Error(`Not a platform: ${JSON.stringify(platform)}`)
  if (typeof handle !== 'string') throw new TypeError('The handle must be a string')
  const parent = options?.parent === undefined ? PARENT_NAME : parentName(options.parent)
  const chain = options?.chain === undefined ? [] : [chainLabel(options.chain)]
  // Every Platform has released rules.
  const labels = handleLabels(platform, normalize(handle, rulesFor(platform)!))
  if (labels === null) return null
  return [...labels, platform, ...chain, parent].join('.')
}

/**
 * Whether ENSIP-15 leaves `label` unchanged and DNS can carry it: lowercase
 * ASCII letters, digits and `-`, 1 to 63 bytes, and not `-` at both the third
 * and fourth characters, which ENSIP-15 reserves.
 */
function isLabel(label: unknown): label is string {
  return (
    typeof label === 'string' &&
    /^[a-z0-9-]{1,63}$/.test(label) &&
    !(label[2] === '-' && label[3] === '-')
  )
}

/**
 * The labels a normalized handle becomes, before the platform label
 * (REQ-ENS-LABEL-01 to -04), or `null` when the handle has none.
 */
function handleLabels(platform: Platform, handle: string): string[] | null {
  switch (platform) {
    case PLATFORM_X_KEY:
      return xLabels(handle)
    case PLATFORM_GITHUB_KEY:
      return isLabel(handle) ? [handle] : null
    case PLATFORM_GOOGLE_KEY:
      return googleLabels(handle)
  }
}

/**
 * X issues no `-`, so `_` becomes `-` and comes back. `__` at the third and
 * fourth characters becomes ENSIP-15's reserved `--`, which has no name.
 */
function xLabels(handle: string): string[] | null {
  if (handle.includes('-')) return null
  const label = handle.replaceAll('_', '-')
  return isLabel(label) ? [label] : null
}

/**
 * Gmail: the local part's dot-separated pieces. Any other domain: the local
 * part's pieces, `_at`, then the domain's pieces, each piece a label of its own
 * so no piece can be `_at`.
 */
function googleLabels(handle: string): string[] | null {
  const [local, domain, ...rest] = handle.split('@')
  if (local === undefined || domain === undefined || rest.length > 0) return null
  if (domain === 'gmail.com') return GMAIL_LOCAL.test(local) ? pieces(local) : null
  const localLabels = pieces(local)
  const domainLabels = pieces(domain)
  return localLabels && domainLabels ? [...localLabels, AT, ...domainLabels] : null
}

/** The dot-separated pieces of `text`, or `null` unless every one is a label. */
function pieces(text: string): string[] | null {
  const labels = text.split('.')
  return labels.every(isLabel) ? labels : null
}

function chainLabel(chain: unknown): string {
  if (!isLabel(chain) || (PLATFORMS as readonly string[]).includes(chain))
    throw new Error(`Not a chain label: ${JSON.stringify(chain)}`)
  return chain
}

function parentName(parent: unknown): string {
  if (typeof parent !== 'string' || !parent.split('.').every(isLabel))
    throw new Error(`Not a parent name: ${JSON.stringify(parent)}`)
  return parent
}
