import type { LedgerId } from '@libid/ledger'
import { type ConnectOptions, type Message, PopupConnection, type PopupWindow } from '@libid/popup'
import {
  CHAIN_ID_BYTES,
  MAX_TRANSACTION_DATA_BYTES,
  OPERATION_DOMAIN_BYTES,
} from '../../platforms/authorization.js'
import {
  commonVersions,
  type PlatformId,
  type SupportedCeremonyVersion,
  supportedPlatforms,
} from '../../platforms/index.js'
import { hasExactKeys, isFixedBytes, isOrigin } from '../../primitives.js'
import { isCeremonyId } from '../navigation.js'
import { type Ceremony, ClientCeremony } from './ceremony.js'
import { type CeremonyConfig, fetchCeremonyConfig } from './config.js'
import { fetchPlatformVersions, type PlatformVersions } from './versions.js'

/** Application-scoped Bridge configuration used to construct independent ceremony runs. */
export interface CCDPClient {
  /**
   * Connect an application-owned popup under a fresh connection ID, admitting only this Bridge
   * and its configured CCDP. Other popup options pass through; the caller retains the connection
   * and owns closure.
   */
  connect<Out extends Message = Message, In extends Message = Out>(
    popup: PopupWindow,
    options?: Omit<ConnectOptions, 'allowedPopupOrigins' | 'connectionId'>,
  ): PopupConnection<Out, In>
  /**
   * Platforms the Bridge configures and the Distribution bundles at a version this package
   * implements, in catalog order.
   */
  readonly enabledPlatforms: readonly PlatformId[]
  /**
   * Ascending intersection of the package catalog and the Distribution's list; an immutable
   * list, empty for a platform the Bridge does not configure.
   */
  enabledVersions<P extends PlatformId>(platformId: P): readonly SupportedCeremonyVersion<P>[]
  /**
   * Snapshot ledger hash/address and input bytes before OAuth; invalid inputs throw synchronously.
   * The connection's `connectionId` is the ceremony ID; use one connection per live run.
   * Omitted version selects the highest compatible version, not a disclosure preference.
   */
  new: <P extends PlatformId>(
    conn: PopupConnection<Message>,
    platformId: P,
    ledgerId: LedgerId,
    operationDomain: Uint8Array,
    transactionData: Uint8Array,
    ceremonyVersion?: SupportedCeremonyVersion<P>,
  ) => Ceremony<P>
}

/**
 * Fetch and validate the Bridge configuration, then the configured Distribution's version
 * list, once each. Rejects when either is unavailable or malformed, since every ceremony
 * needs both.
 */
export async function createCCDPClient(options: { oauthBridge: string }): Promise<CCDPClient> {
  if (!hasExactKeys(options, ['oauthBridge'])) throw new TypeError('Invalid client options')
  const config = await fetchCeremonyConfig(options.oauthBridge)
  return ccdpClientFromConfig(config, await fetchPlatformVersions(config.ccdpOrigin))
}

/** Construction from an already validated, frozen Bridge configuration and Distribution list. */
function ccdpClientFromConfig(config: CeremonyConfig, versions: PlatformVersions): CCDPClient {
  const popupOrigins = [...new Set([new URL(config.redirectUri).origin, config.ccdpOrigin])]
  const liveIds = new Set<string>()
  // A platform the Bridge does not configure has no client, whatever the Distribution bundles.
  const enabledVersions = <P extends PlatformId>(platform: P) =>
    commonVersions(
      platform,
      Object.hasOwn(config.platforms, platform) ? (versions[platform] ?? []) : [],
    )
  const enabledPlatforms = Object.freeze(
    supportedPlatforms.filter((p) => enabledVersions(p).length > 0),
  )
  // Contextually typed by CCDPClient, whose declarations carry the documented signatures.
  const client: CCDPClient = {
    enabledPlatforms,
    enabledVersions,
    connect(popup, options = {}) {
      // The client generates the ID, as the carried protocol (REQ-POPUP-ID-02); each is fresh.
      return PopupConnection.connect(popup, {
        ...options,
        connectionId: crypto.randomUUID(),
        allowedPopupOrigins: popupOrigins,
      })
    },
    new(conn, platformId, ledgerId, operationDomain, transactionData, ceremonyVersion) {
      // A connection constructed elsewhere may carry any value; only a canonical UUID runs.
      const id = conn.connectionId
      if (typeof id !== 'string' || !isCeremonyId(id) || !enabledPlatforms.includes(platformId))
        throw new TypeError('Invalid ceremony selection')
      const version = selectVersion(enabledVersions(platformId), ceremonyVersion)
      const ledger = snapshotLedger(ledgerId)
      if (!isFixedBytes(operationDomain, OPERATION_DOMAIN_BYTES))
        throw new TypeError('Operation domain must be 32 bytes')
      if (
        !(transactionData instanceof Uint8Array) ||
        transactionData.length > MAX_TRANSACTION_DATA_BYTES
      )
        throw new TypeError('Invalid transaction bytes')
      if (liveIds.has(id)) throw new TypeError('Ceremony ID is already live')
      const input = { ...ledger, platformId, version, operationDomain, transactionData }
      const run = new ClientCeremony(id, conn, input, config, () => {
        liveIds.delete(id)
      })
      liveIds.add(id)
      return run
    },
  }
  return Object.freeze(client)
}

/** An omitted version selects the highest compatible one. */
function selectVersion<V>(available: readonly V[], requested: V | undefined): V {
  const version = requested === undefined ? available[available.length - 1] : requested
  if (!available.includes(version)) throw new TypeError('Unsupported ceremony version')
  return version
}

/** Read each ledger method once; later replacement of either method cannot affect the run. */
function snapshotLedger(ledgerId: LedgerId): { chainId: Uint8Array; notaryAddress: string } {
  if (!ledgerId || typeof ledgerId.hash !== 'function')
    throw new TypeError('Invalid ledger identity')
  const chainId = ledgerId.hash()
  if (!isFixedBytes(chainId, CHAIN_ID_BYTES)) throw new TypeError('Ledger hash must be 32 bytes')
  if (typeof ledgerId.notaryAddress !== 'function') throw new TypeError('Missing notary address')
  const notaryAddress = ledgerId.notaryAddress()
  if (!isOrigin(notaryAddress)) throw new TypeError('Invalid notary origin')
  return { chainId, notaryAddress }
}
