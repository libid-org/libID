import type { BrowserContext } from '@playwright/test'

/**
 * An injected EIP-1193 wallet for the test page. It answers account requests
 * with an account anvil keeps unlocked, and forwards everything else, signing
 * included, to anvil, so no private key enters the page.
 */
export async function injectWallet(context: BrowserContext, rpcUrl: string, account: string) {
  await context.addInitScript(
    ({ rpcUrl, account }) => {
      let id = 0
      const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
        })
        const body = await response.json()
        if (body.error) throw Object.assign(new Error(body.error.message), body.error)
        return body.result
      }
      Object.defineProperty(window, 'ethereum', {
        value: { request, on() {}, removeListener() {} },
      })
    },
    { rpcUrl, account },
  )
}
