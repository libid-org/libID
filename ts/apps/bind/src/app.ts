import { type Ceremony, CeremonyStage, createCCDPClient, type IdentityResult } from '@libid/ceremony'
import { identityRegistryAbi, platformId, resolveId } from '@libid/contracts'
import { PopupWindow } from '@libid/popup'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  type EIP1193Provider,
  hexToBytes,
  http,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { authorizedTransactionData, encodeTlsNotaryPayload, evmLedger } from './evm.ts'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:4688'
const REGISTRY: Address = '0x0531b83b010a6b0c24c2c2c1a6beecc90cc71366'
const BRIDGE = 'http://localhost:4682'
const NOTARY = 'http://localhost:4687'
const chain = defineChain({
  id: 31337,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
const registry = { client: publicClient, address: REGISTRY }
const ledger = evmLedger(chain.id, NOTARY)

const field = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
const show = (id: string, text: string) => {
  field(id).textContent = text
}
const status = (text: string) => show('status', text)
const connectButton = document.querySelector<HTMLButtonElement>('#connect')!
const bindAnchor = document.querySelector<HTMLAnchorElement>('#bind-github')!

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

async function submit(result: Extract<IdentityResult<'github'>, { status: 'accepted' }>, transactionData: Uint8Array, operationDomain: Uint8Array) {
  if (!wallet || !holder) throw new Error('Wallet disconnected')
  show('proof-received', `${result.identity.userName} (${result.identity.userId})`)
  const github = platformId('github')
  const value = await publicClient.readContract({
    address: REGISTRY,
    abi: identityRegistryAbi,
    functionName: 'quoteBind',
    args: [github, result.oauthProof.platformCeremonyVersion],
  })
  const payload = encodeTlsNotaryPayload(result.oauthProof, operationDomain, transactionData)
  status('Submitting the binding…')
  const { request } = await publicClient.simulateContract({
    account: holder,
    address: REGISTRY,
    abi: identityRegistryAbi,
    functionName: 'bind',
    args: [github, result.oauthProof.platformCeremonyVersion, payload, true],
    value,
  })
  const hash = await wallet.writeContract({ ...request, account: wallet.account ?? holder })
  show('tx-hash', hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  show('receipt-status', `${receipt.status} in block ${receipt.blockNumber}`)
  if (receipt.status !== 'success') throw new Error('The binding transaction reverted')

  const bound = await resolveId(registry, github, result.identity.userId)
  show('registry-holder', bound ?? 'not bound')
  status('Bound on chain. Waiting for the indexer…')
  show('indexer-holder', await indexed(result.identity.userId))
  status('Done.')
}

/** The holder the indexer reports for a GitHub id, polled until it appears. */
async function indexed(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`/indexer/v1/resolve/id/github/${encodeURIComponent(userId)}`)
    if (response.ok) {
      const body = (await response.json()) as { bindings: { chainId: number; owner: string }[] }
      const local = body.bindings.find((binding) => binding.chainId === chain.id)
      if (local) return local.owner
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return 'not indexed after 60 s'
}

async function initialize() {
  const client = await createCCDPClient({ oauthBridge: BRIDGE })
  if (!client.enabledPlatforms.includes('github')) {
    status('The Bridge does not enable GitHub.')
    return
  }
  const operationDomain = hexToBytes(
    await publicClient.readContract({ address: REGISTRY, abi: identityRegistryAbi, functionName: 'OPERATION_DOMAIN' }),
  )
  connectButton.addEventListener('click', () => {
    connect().then(
      () => {
        bindAnchor.setAttribute('aria-disabled', 'false')
        status('Ready. Click Bind GitHub.')
      },
      (error: unknown) => status(error instanceof Error ? error.message : 'Could not connect a wallet.'),
    )
  })
  bindAnchor.addEventListener('click', (event) => {
    if (!holder) {
      event.preventDefault()
      return
    }
    const id = crypto.randomUUID()
    const target = `ceremony-${id}`
    // Window creation stays synchronous with the click.
    const popup = PopupWindow.open(target)
    const connection = client.connect(popup, { connectionId: id })
    const transactionData = authorizedTransactionData(holder)
    let ceremony: Ceremony<'github'>
    try {
      ceremony = client.new(connection, id, 'github', ledger, operationDomain, transactionData)
    } catch (error) {
      event.preventDefault()
      connection.close()
      status(error instanceof Error ? error.message : 'Unable to start the ceremony.')
      return
    }
    bindAnchor.target = target
    bindAnchor.href = ceremony.launchUrl
    if (popup.opened) event.preventDefault()
    const off = ceremony.onStage((update) => {
      show('stage', update.status === 'active' ? CeremonyStage.message(update.stage, 'GitHub') : update.status)
    })
    void ceremony
      .proveUserIdentity()
      .then(async (result) => {
        connection.close()
        if (result.status !== 'accepted') {
          status('GitHub denied the authorization.')
          return
        }
        await submit(result, transactionData, operationDomain)
      })
      .catch((error: unknown) => status(error instanceof Error ? error.message : 'The binding failed.'))
      .finally(off)
  })
  status('Connect a wallet to start.')
}

void initialize().catch(() => status('Could not load the Bridge configuration. Is the stack running?'))
