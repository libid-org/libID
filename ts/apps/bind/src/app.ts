import {
  type CCDPClient,
  type Ceremony,
  CeremonyStage,
  createCCDPClient,
  type IdentityResult,
  type OAuthProof,
} from '@libid/ceremony'
import { identityRegistryAbi, platformId, resolveId } from '@libid/contracts'
import { PopupWindow } from '@libid/popup'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  type EIP1193Provider,
  getContract,
  hexToBytes,
  http,
  isAddressEqual,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  BRIDGE,
  CHAIN_ID,
  NOTARY,
  type Platform,
  REGISTRY,
  RPC_URL,
  VERIFIER_VERSION,
} from '../local.ts'
import {
  authorizedTransactionData,
  encodeGooglePayload,
  encodeTlsNotaryPayload,
  evmLedger,
} from './evm.ts'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
const registry = getContract({ address: REGISTRY, abi: identityRegistryAbi, client: publicClient })
const ledger = evmLedger(chain.id, NOTARY)

const field = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
const show = (id: string, text: string) => {
  field(id).textContent = text
}
const status = (text: string) => show('status', text)
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback
/** End the run with `message` as its outcome. */
const fail = (message: string) => {
  status(message)
  show('outcome', `failed: ${message}`)
}
const connectButton = document.querySelector<HTMLButtonElement>('#connect')!

const names: Record<Platform, string> = { github: 'GitHub', x: 'X', google: 'Google' }
const platforms = Object.keys(names) as Platform[]
const anchors = Object.fromEntries(
  platforms.map((platform) => [
    platform,
    document.querySelector<HTMLAnchorElement>(`#bind-${platform}`)!,
  ]),
) as Record<Platform, HTMLAnchorElement>

let wallet: WalletClient | undefined
let holder: Address | undefined

/** An injected wallet if the page has one; otherwise the development key, for manual runs. */
async function connect() {
  if (window.ethereum) {
    wallet = createWalletClient({ chain, transport: custom(window.ethereum) })
    ;[holder] = await wallet.requestAddresses()
  } else {
    const key = import.meta.env.VITE_DEV_PRIVATE_KEY as `0x${string}` | undefined
    if (!key) throw new Error('No wallet: install one, or set VITE_DEV_PRIVATE_KEY for local runs.')
    const account = privateKeyToAccount(key)
    wallet = createWalletClient({ account, chain, transport: http(RPC_URL) })
    holder = account.address
  }
  show('holder', holder)
}

type Accepted = Extract<IdentityResult<Platform>, { status: 'accepted' }>

/** GitHub and X prove through TLSNotary sessions; Google through a signed ID token. */
function payloadOf(result: Accepted, operationDomain: Uint8Array, transactionData: Uint8Array) {
  return result.identity.platformId === 'google'
    ? encodeGooglePayload(
        result.oauthProof as OAuthProof<'google'>,
        result.identity.oauthClientId,
        operationDomain,
        transactionData,
      )
    : encodeTlsNotaryPayload(
        result.oauthProof as OAuthProof<'github' | 'x'>,
        operationDomain,
        transactionData,
      )
}

/** The wallet and holder a ceremony started with; its transaction data names this holder. */
interface Signer {
  wallet: WalletClient
  holder: Address
}

async function submit(
  platform: Platform,
  { wallet, holder }: Signer,
  result: Accepted,
  transactionData: Uint8Array,
  operationDomain: Uint8Array,
) {
  show('proof-received', `${result.identity.userName} (${result.identity.userId})`)
  const id = platformId(platform)
  const value = await registry.read.quoteBind([id, VERIFIER_VERSION])
  const payload = payloadOf(result, operationDomain, transactionData)
  status('Submitting the binding…')
  const { request } = await registry.simulate.bind([id, VERIFIER_VERSION, payload, true], {
    account: holder,
    value,
  })
  const hash = await wallet.writeContract({ ...request, account: wallet.account ?? holder })
  show('tx-hash', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  show('receipt-status', `${receipt.status} in block ${receipt.blockNumber}`)
  if (receipt.status !== 'success') throw new Error('The binding transaction reverted')

  const bound = await resolveId(
    { client: publicClient, address: REGISTRY },
    id,
    result.identity.userId,
  )
  show('registry-holder', bound ?? 'not bound')
  if (!bound || !isAddressEqual(bound, holder))
    throw new Error(`The registry binds the identity to ${bound ?? 'no one'}, not ${holder}`)
  status('Bound on chain. Waiting for the indexer…')
  const owner = await indexed(platform, result.identity.userId)
  show('indexer-holder', owner ?? 'not indexed after 60 s')
  if (!owner) throw new Error('The indexer did not report the binding within 60 s')
  if (!isAddressEqual(owner as Address, holder))
    throw new Error(`The indexer reports ${owner} as the holder, not ${holder}`)
  status('Done.')
  show('outcome', 'bound')
}

/** The holder the indexer reports for an id, polled until it appears; undefined after 60 s. */
async function indexed(platform: Platform, userId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`/indexer/v1/resolve/id/${platform}/${encodeURIComponent(userId)}`)
    if (response.ok) {
      const body = (await response.json()) as { bindings: { chainId: number; owner: string }[] }
      const local = body.bindings.find((binding) => binding.chainId === chain.id)
      if (local) return local.owner
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return undefined
}

/** Start a ceremony for `platform` from its anchor's click, then bind what it proves. */
function launch(
  client: CCDPClient,
  platform: Platform,
  event: MouseEvent,
  operationDomain: Uint8Array,
) {
  if (!wallet || !holder) {
    event.preventDefault()
    return
  }
  const signer: Signer = { wallet, holder }
  // Window creation and the run's start stay synchronous with the click.
  const connection = client.connect(PopupWindow.fromAnchor(event))
  const transactionData = authorizedTransactionData(signer.holder)
  let ceremony: Ceremony<Platform>
  try {
    ceremony = client.new(connection, platform, ledger, operationDomain, transactionData)
  } catch (error) {
    event.preventDefault()
    connection.close()
    fail(messageOf(error, 'Unable to start the ceremony.'))
    return
  }
  const off = ceremony.onStage((update) => {
    show(
      'stage',
      update.status === 'active'
        ? CeremonyStage.message(update.stage, names[platform])
        : update.status,
    )
  })
  void ceremony
    .proveUserIdentity()
    .then(async (result) => {
      connection.close()
      if (result.status !== 'accepted')
        throw new Error(`${names[platform]} denied the authorization.`)
      await submit(platform, signer, result, transactionData, operationDomain)
    })
    .catch((error: unknown) => fail(messageOf(error, 'The binding failed.')))
    .finally(() => {
      connection.close()
      off()
    })
}

async function initialize() {
  const client = await createCCDPClient({ oauthBridge: BRIDGE })
  const enabled = platforms.filter((platform) => client.enabledPlatforms.includes(platform))
  const operationDomain = hexToBytes(await registry.read.OPERATION_DOMAIN())
  connectButton.addEventListener('click', () => {
    connect().then(
      () => {
        for (const platform of enabled) anchors[platform].setAttribute('aria-disabled', 'false')
        status('Ready. Choose a platform to bind.')
      },
      (error: unknown) => status(messageOf(error, 'Could not connect a wallet.')),
    )
  })
  for (const platform of enabled)
    anchors[platform].addEventListener('click', (event) =>
      launch(client, platform, event, operationDomain),
    )
  status('Connect a wallet to start.')
}

void initialize().catch((error: unknown) =>
  status(
    `Could not start: ${error instanceof Error ? error.message : String(error)}. Is the stack running?`,
  ),
)
