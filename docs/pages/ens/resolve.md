---
title: Resolve with ENS
description: Look up a handles.link name with viem or any ENS library.
sidebar:
  order: 2
---

A `handles.link` name resolves like any other ENS name. Your library needs to
support wildcard names ([ENSIP-10](https://docs.ens.domains/ensip/10)) and
offchain lookups ([ERC-3668](https://eips.ethereum.org/EIPS/eip-3668)). viem
and ethers v6 support both.

This works once `handles.link` is live; see
[Status](/docs/ens/names/#status). Until then the example returns `null`.

## With viem

ENS lives on Ethereum mainnet, so connect to mainnet even if you send on
another chain. Pass the chain you want an address for as a coin type:

```js
import { createPublicClient, http } from 'viem';
import { mainnet, base } from 'viem/chains';
import { toCoinType } from 'viem';

const client = createPublicClient({ chain: mainnet, transport: http() });

const address = await client.getEnsAddress({
  name: 'octocat.github.handles.link',
  coinType: toCoinType(base.id),
});
```

`address` is the holder of `octocat` on GitHub, as recorded on Base.
It is `null` if nobody owns the handle on Base.

Without `coinType`, you get the address on Ethereum mainnet.

## In a wallet

Paste the name into the recipient field. Wallets that support ENS subnames
with offchain lookups, such as MetaMask, resolve it the same way.

## Compared to IdentityRegistry

ENS and `IdentityRegistry` give the same answer. Which one to use depends on
where the name comes from:

- Use ENS when a person types or pastes a name, or when you want names to
  work in wallets you do not control.
- Use `IdentityRegistry` from your own code and contracts. It needs no gateway,
  and it can also tell you when the handle was proved. See
  [Resolve a handle](/docs/guides/resolve-handle/).
