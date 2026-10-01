import { vi } from 'vitest'
import { VERSIONS_PATH } from '../assets/keys.js'
import { type CCDPClient, createCCDPClient } from '../ccdp/client/client.js'
import { bundledVersions } from './platforms.js'

/** The Bridge origin every test client is configured through. */
export const BRIDGE = 'https://bridge.test'

/**
 * A client created as an application creates one: from the Bridge's public `config` record and
 * the Distribution's `versions` list, served locally.
 */
export async function ccdpClient(
  config: unknown,
  versions: unknown = bundledVersions,
): Promise<CCDPClient> {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) =>
      Response.json(String(input).endsWith(VERSIONS_PATH) ? versions : config),
    )
  try {
    return await createCCDPClient({ oauthBridge: BRIDGE })
  } finally {
    fetch.mockRestore()
  }
}
