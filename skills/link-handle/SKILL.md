---
name: link-handle
description: Link your human's X, GitHub or Google account to your own EVM wallet through libID, so payments to their handle reach you. Use when your human asks for this.
compatibility: Requires bash, curl, jq and openssl; Foundry cast for keystore wallets.
---

# Link your human's handle to your wallet

libID's `IdentityRegistry` links an X, GitHub or Google account to an EVM address.
Your human proves the account in their browser on lib.id; you send one transaction
from your wallet. Never ask for their password or sign-in codes.

Your wallet must be able to send a contract call with arbitrary calldata from its own
address. Wallets limited to transfers and swaps, such as Coinbase's `awal`, cannot
link. For a smart account, link the smart account's address, not its signer's.

Keep `LAUNCHER`, `CHAIN`, `RPC`, `REGISTRY`, `MAX`, `ADDR` and `SESSION` for later
steps. If your shell forgets variables between commands, write them to a file and
`source` it.

## 1. Pick a network

| Chain | `CHAIN` | `RPC` | `REGISTRY` | `MAX` (wei) |
|---|---|---|---|---|
| Ethereum | `1` | `https://ethereum-rpc.publicnode.com` | `0xbefd300aff7d4a67fb381afe8b3596793d3e9a83` | `360000000000000` |
| Eden testnet | `3735928814` | `https://rpc.testnet.eden.gateway.fm/` | `0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d` | `0` |
| Sepolia | `11155111` | `https://ethereum-sepolia-rpc.publicnode.com` | `0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d` | `200000000000000` |

```bash
LAUNCHER=https://lib.id
```

`MAX` is the verification fee: X and GitHub pay for two notarizations, Google pays
none. Linking also takes 4–7 million gas. The link holds on that chain only, so fund
your wallet there first. Another launcher works the same way if it serves the two
endpoints in [Launchers](#launchers).

## 2. Get your address

Set `ADDR` with your wallet's command from [step 5](#5-send-it-from-your-wallet).

## 3. Give your human the link

```bash
SESSION=$(openssl rand -hex 16)
echo "$LAUNCHER/link/agent/#address=$ADDR&chain=$CHAIN&session=$SESSION"
```

Send it with: "Open this link and sign in with the account you want to link to my
wallet." On their own computer, you can also `open` or `xdg-open` it. Keep `SESSION`
between you and your human: whoever holds it can hand you a transaction.

If your human explicitly asks you to sign in for them, open the link in your own
browser and let a password manager such as 1Password or Bitwarden fill the login;
never read or type their password or codes yourself. Keep that browser open until
step 4 finishes: the proof is made in it.

## 4. Wait for the transaction

```bash
for _ in $(seq 180); do TX=$(curl -sf "$LAUNCHER/api/agent-link/$SESSION") && break; sleep 5; done
jq -e --arg c "$CHAIN" --arg r "$REGISTRY" --arg m "$MAX" \
  '(.chainId | tostring) == $c and (.to | ascii_downcase) == $r
   and (.data | startswith("0x1bb7eddb")) and .data[202:330] == ("0" * 128)
   and (.value | tonumber) <= ($m | tonumber) and .expiresAt > now' <<<"$TX" >/dev/null &&
  echo "Ready to link $(jq -r '.handle + " on " + .platform' <<<"$TX")" ||
  echo "Check failed. Do not send."
```

Until your human finishes, the launcher answers `404`. If `TX` is still empty after
15 minutes, ask them whether the page finished. Once it does, the transaction stays
available for an hour; send it promptly. It looks like this:

```json
{"chainId":1,"to":"0xbefd…","data":"0x1bb7eddb…","value":"360000000000000","platform":"x","handle":"alice","expiresAt":1793000000}
```

The check accepts only a `bindPrivately` call to the registry with no service fee,
worth at most `MAX`, before `expiresAt` (Unix seconds). `handle` and `platform` are the page's labels for
your human, not part of the check. If the value is above `MAX`, the fees changed: ask
your human first.

## 5. Send it from your wallet

### Foundry keystore (bot.fun agents)

bot.fun agents sign with the `botfun-agent` keystore from
[bot.fun's SKILL.md](https://bot.fun/SKILL.md). No launcher serves Eden mainnet (714)
yet, so fund that address on Ethereum or Eden testnet and send through `RPC`, not
bot.fun's submit API.

```bash
KEY=(--account botfun-agent --password-file ~/.foundry/keystores/botfun-agent.password)
ADDR=$(cast wallet address "${KEY[@]}")
# After step 4:
cast send "$(jq -r .to <<<"$TX")" "$(jq -r .data <<<"$TX")" --value "$(jq -r .value <<<"$TX")" \
  --chain "$CHAIN" --rpc-url "$RPC" "${KEY[@]}"
```

`cast send` simulates before it signs and waits for the receipt. `status 1 (success)`
means linked.

### Privy server wallet

Use Ethereum or Sepolia. Your wallet's policy must allow a call to `REGISTRY` with
that value.

```bash
PRIVY=(--user "$PRIVY_APP_ID:$PRIVY_APP_SECRET" -H "privy-app-id: $PRIVY_APP_ID")
ADDR=$(curl -s "https://api.privy.io/v1/wallets/$WALLET_ID" "${PRIVY[@]}" | jq -er .address)
# After step 4:
RES=$(jq '{method: "eth_sendTransaction", caip2: "eip155:\(.chainId)",
           params: {transaction: {to, data, value}}}' <<<"$TX" |
  curl -s -X POST "https://api.privy.io/v1/wallets/$WALLET_ID/rpc" "${PRIVY[@]}" \
    -H 'Content-Type: application/json' -d @-)
HASH=$(jq -er .data.hash <<<"$RES") && cast receipt "$HASH" status --rpc-url "$RPC" || echo "$RES"
```

Status `1` means linked.

### Any other wallet

Send `to`, `data` and `value` (wei) on `chainId` from `ADDR`. The registry accepts the
link only from that address, so a relayer cannot send it for you.

## 6. Tell your human

"Linked alice on X to my wallet `0x…` on Ethereum." On Ethereum, ENS-aware wallets pay
`alice.x.handles.link`. On the testnets, people pay the handle at
`https://testnet.handles.link/send/`.

If sending fails before broadcast, for example for lack of gas, fund the wallet and
resend the same `TX` while `expiresAt` is ahead. A reverted or expired link needs a new
one: start again from step 3.

## Launchers

A launcher is a libID application whose origin its OAuth Bridges admit; lib.id is
one. It serves:

- `$LAUNCHER/link/agent/#address=…&chain=…&session=…`: a page where the human proves
  an account. The launcher builds the registry's `bindPrivately` call for `address`,
  with no service fee, and simulates it from that address.
- `$LAUNCHER/api/agent-link/$SESSION`: the endpoint step 4 polls. Only the first write
  counts.
